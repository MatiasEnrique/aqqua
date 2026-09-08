//! Hub state: sessions on many providers, their parent links, turn tracking, and the mailbox.
//!
//! The hub is an ACP agent toward the UI and an ACP client toward every provider process.
//! Every provider session, root or child, is a `Session` here and is addressed by a hub
//! session id that the hub mints before the provider session exists, so the id can be
//! handed to the provider's MCP shim as part of `session/new`.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, PermissionOptionKind, PromptRequest, PromptResponse,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionId, SessionInfo, SessionModeId, SessionNotification,
    SessionUpdate, SetSessionModeRequest, StopReason, TextContent, ToolCall, ToolCallContent,
    ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use agent_client_protocol::{Agent, Client, ConnectionTo, Responder};
use anyhow::{Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, oneshot};

use crate::config::{Config, ProviderConfig};
use crate::downstream;

pub type HubSessionId = String;

pub struct Hub {
    pub config: Config,
    pub socket_path: PathBuf,
    pub exe: PathBuf,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    upstream: Option<ConnectionTo<Client>>,
    sessions: HashMap<HubSessionId, Session>,
}

pub struct Session {
    pub id: HubSessionId,
    pub provider: String,
    pub cwd: PathBuf,
    pub title: Option<String>,
    pub parent: Option<HubSessionId>,
    pub depth: usize,
    pub created_at: String,
    pub updated_at: String,
    pub children: Vec<HubSessionId>,
    downstream: Option<Downstream>,
    turn: TurnState,
    pub last_result: Option<TurnResult>,
    waiters: Vec<oneshot::Sender<TurnResult>>,
    /// Assistant text of the turn in flight, used as the child's final message.
    current_text: String,
    pub inbox: VecDeque<AgentMessage>,
}

#[derive(Clone)]
pub struct Downstream {
    pub cx: ConnectionTo<Agent>,
    pub session_id: SessionId,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TurnState {
    Idle,
    Running,
}

#[derive(Debug, Clone, Serialize)]
pub struct TurnResult {
    pub status: String,
    pub stop_reason: Option<String>,
    pub final_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: String,
    pub from: HubSessionId,
    pub to: HubSessionId,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub session_id: HubSessionId,
    pub provider: String,
    pub title: Option<String>,
    pub parent: Option<HubSessionId>,
    pub status: String,
    pub updated_at: String,
}

pub fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

impl Hub {
    pub fn new(config: Config, socket_path: PathBuf, exe: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            config,
            socket_path,
            exe,
            state: Mutex::new(State::default()),
        })
    }

    pub async fn set_upstream(&self, cx: ConnectionTo<Client>) {
        self.state.lock().await.upstream = Some(cx);
    }

    async fn upstream(&self) -> Option<ConnectionTo<Client>> {
        self.state.lock().await.upstream.clone()
    }

    /// Create a session on `provider`, spawning the provider process and waiting until
    /// its `session/new` has completed.
    pub async fn create_session(
        self: &Arc<Self>,
        provider: Option<&str>,
        cwd: PathBuf,
        parent: Option<HubSessionId>,
        title: Option<String>,
    ) -> Result<HubSessionId> {
        let (provider_name, provider_cfg): (String, ProviderConfig) =
            self.config.resolve_provider(provider)?;
        let id = uuid::Uuid::new_v4().to_string();
        let depth = {
            let mut state = self.state.lock().await;
            let depth = match &parent {
                Some(parent_id) => {
                    let parent_session = state
                        .sessions
                        .get_mut(parent_id)
                        .ok_or_else(|| anyhow!("unknown parent session {parent_id}"))?;
                    parent_session.children.push(id.clone());
                    parent_session.depth + 1
                }
                None => 0,
            };
            let now = now_iso();
            state.sessions.insert(
                id.clone(),
                Session {
                    id: id.clone(),
                    provider: provider_name.clone(),
                    cwd: cwd.clone(),
                    title,
                    parent,
                    depth,
                    created_at: now.clone(),
                    updated_at: now,
                    children: Vec::new(),
                    downstream: None,
                    turn: TurnState::Idle,
                    last_result: None,
                    waiters: Vec::new(),
                    current_text: String::new(),
                    inbox: VecDeque::new(),
                },
            );
            depth
        };
        tracing::info!(session = %id, provider = %provider_name, depth, "creating session");

        match downstream::spawn(self.clone(), id.clone(), provider_name, provider_cfg, cwd).await {
            Ok(ds) => {
                let mut state = self.state.lock().await;
                if let Some(session) = state.sessions.get_mut(&id) {
                    session.downstream = Some(ds);
                }
                Ok(id)
            }
            Err(error) => {
                self.remove_session(&id).await;
                Err(error)
            }
        }
    }

    async fn remove_session(&self, id: &str) {
        let mut state = self.state.lock().await;
        if let Some(session) = state.sessions.remove(id)
            && let Some(parent_id) = session.parent
            && let Some(parent) = state.sessions.get_mut(&parent_id)
        {
            parent.children.retain(|child| child != id);
        }
    }

    /// The provider process behind a session went away.
    pub async fn on_downstream_closed(&self, id: &str) {
        let waiters = {
            let mut state = self.state.lock().await;
            let Some(session) = state.sessions.get_mut(id) else {
                return;
            };
            session.downstream = None;
            let result = TurnResult {
                status: "failed".to_string(),
                stop_reason: Some("provider_exited".to_string()),
                final_message: None,
            };
            let was_running = session.turn == TurnState::Running;
            session.turn = TurnState::Idle;
            if was_running {
                session.last_result = Some(result.clone());
            }
            std::mem::take(&mut session.waiters)
                .into_iter()
                .map(|waiter| (waiter, result.clone()))
                .collect::<Vec<_>>()
        };
        for (waiter, result) in waiters {
            let _ = waiter.send(result);
        }
        tracing::warn!(session = %id, "provider connection closed");
    }

    async fn downstream(&self, id: &str) -> Result<Downstream> {
        let state = self.state.lock().await;
        let session = state
            .sessions
            .get(id)
            .ok_or_else(|| anyhow!("unknown session {id}"))?;
        session
            .downstream
            .clone()
            .ok_or_else(|| anyhow!("session {id} has no live provider connection"))
    }

    /// Run one prompt turn on a session and wait for it to settle.
    pub async fn prompt(&self, id: &str, prompt: Vec<ContentBlock>) -> Result<PromptResponse> {
        let ds = self.downstream(id).await?;
        {
            let mut state = self.state.lock().await;
            let session = state
                .sessions
                .get_mut(id)
                .ok_or_else(|| anyhow!("unknown session {id}"))?;
            if session.turn == TurnState::Running {
                bail!("session {id} already has a turn in flight");
            }
            session.turn = TurnState::Running;
            session.current_text.clear();
            session.updated_at = now_iso();
        }
        let outcome = ds
            .cx
            .send_request(PromptRequest::new(ds.session_id.clone(), prompt))
            .block_task()
            .await;
        let result = match &outcome {
            Ok(response) => TurnResult {
                status: match response.stop_reason {
                    StopReason::Cancelled => "cancelled".to_string(),
                    _ => "completed".to_string(),
                },
                stop_reason: Some(format!("{:?}", response.stop_reason)),
                final_message: None,
            },
            Err(error) => TurnResult {
                status: "failed".to_string(),
                stop_reason: Some(error.to_string()),
                final_message: None,
            },
        };
        self.finish_turn(id, result).await;
        outcome.map_err(|error| anyhow!("provider prompt failed: {error}"))
    }

    async fn finish_turn(&self, id: &str, mut result: TurnResult) {
        let (waiters, parent, child_summary) = {
            let mut state = self.state.lock().await;
            let Some(session) = state.sessions.get_mut(id) else {
                return;
            };
            let text = std::mem::take(&mut session.current_text);
            if !text.trim().is_empty() {
                result.final_message = Some(text);
            }
            session.turn = TurnState::Idle;
            session.updated_at = now_iso();
            session.last_result = Some(result.clone());
            let waiters = std::mem::take(&mut session.waiters);
            (waiters, session.parent.clone(), session.provider.clone())
        };
        for waiter in waiters {
            let _ = waiter.send(result.clone());
        }
        if let Some(parent_id) = parent {
            self.project_child_update(&parent_id, id, &child_summary, &result)
                .await;
        }
    }

    /// Tell the UI that a child's turn settled, as a tool call update in the parent session.
    async fn project_child_update(
        &self,
        parent_id: &str,
        child_id: &str,
        provider: &str,
        result: &TurnResult,
    ) {
        let status = if result.status == "completed" {
            ToolCallStatus::Completed
        } else {
            ToolCallStatus::Failed
        };
        let mut fields = ToolCallUpdateFields::new()
            .status(status)
            .raw_output(serde_json::json!({
                "sessionId": child_id,
                "provider": provider,
                "status": result.status,
                "stopReason": result.stop_reason,
            }));
        if let Some(message) = &result.final_message {
            fields = fields.content(vec![ToolCallContent::Content(
                agent_client_protocol::schema::v1::Content::new(ContentBlock::Text(
                    TextContent::new(message.clone()),
                )),
            )]);
        }
        let update = ToolCallUpdate::new(child_id.to_string(), fields)
            .meta(child_meta(child_id, provider, parent_id));
        self.notify_upstream(SessionNotification::new(
            SessionId::new(parent_id.to_string()),
            SessionUpdate::ToolCallUpdate(update),
        ))
        .await;
    }

    async fn notify_upstream(&self, notification: SessionNotification) {
        if let Some(upstream) = self.upstream().await
            && let Err(error) = upstream.send_notification(notification)
        {
            tracing::debug!(%error, "upstream notification dropped");
        }
    }

    pub async fn cancel(&self, id: &str) -> Result<()> {
        let ds = self.downstream(id).await?;
        ds.cx
            .send_notification(CancelNotification::new(ds.session_id.clone()))
            .map_err(|error| anyhow!("cancel failed: {error}"))
    }

    /// A notification arrived from a provider for the session `id`.
    pub async fn on_downstream_notification(
        &self,
        id: &str,
        mut notification: SessionNotification,
    ) {
        if let SessionUpdate::AgentMessageChunk(chunk) = &notification.update
            && let ContentBlock::Text(text) = &chunk.content
        {
            let mut state = self.state.lock().await;
            if let Some(session) = state.sessions.get_mut(id) {
                session.current_text.push_str(&text.text);
                session.updated_at = now_iso();
            }
        }
        notification.session_id = SessionId::new(id.to_string());
        self.notify_upstream(notification).await;
    }

    /// A provider asked for permission. Root sessions ask the UI; children are answered by policy.
    pub async fn on_permission_request(
        self: &Arc<Self>,
        id: &str,
        mut request: RequestPermissionRequest,
        responder: Responder<RequestPermissionResponse>,
    ) -> Result<(), agent_client_protocol::Error> {
        let (is_child, upstream) = {
            let state = self.state.lock().await;
            let is_child = state
                .sessions
                .get(id)
                .map(|session| session.parent.is_some())
                .unwrap_or(false);
            (is_child, state.upstream.clone())
        };
        if is_child && self.config.children.auto_approve {
            let allow = request
                .options
                .iter()
                .find(|option| {
                    matches!(
                        option.kind,
                        PermissionOptionKind::AllowOnce | PermissionOptionKind::AllowAlways
                    )
                })
                .map(|option| option.option_id.clone());
            let outcome = match allow {
                Some(option_id) => {
                    RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(option_id))
                }
                None => RequestPermissionOutcome::Cancelled,
            };
            return responder.respond(RequestPermissionResponse::new(outcome));
        }
        let Some(upstream) = upstream else {
            return responder.respond(RequestPermissionResponse::new(
                RequestPermissionOutcome::Cancelled,
            ));
        };
        request.session_id = SessionId::new(id.to_string());
        tokio::spawn(async move {
            let outcome = upstream.send_request(request).block_task().await;
            let _ = match outcome {
                Ok(response) => responder.respond(response),
                Err(error) => responder.respond_with_error(error),
            };
        });
        Ok(())
    }

    pub async fn list_sessions(&self) -> Vec<SessionInfo> {
        let state = self.state.lock().await;
        let mut sessions: Vec<&Session> = state.sessions.values().collect();
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        sessions
            .into_iter()
            .map(|session| {
                let mut info =
                    SessionInfo::new(SessionId::new(session.id.clone()), session.cwd.clone());
                info.title = Some(session_title(session));
                info.updated_at = Some(session.updated_at.clone());
                info.meta = Some(session_meta(session));
                info
            })
            .collect()
    }

    pub async fn summaries_for(&self, caller: &str) -> Vec<SessionSummary> {
        let state = self.state.lock().await;
        state
            .sessions
            .values()
            .filter(|session| {
                session.id == caller
                    || session.parent.as_deref() == Some(caller)
                    || state
                        .sessions
                        .get(caller)
                        .and_then(|me| me.parent.clone())
                        .is_some_and(|my_parent| {
                            session.id == my_parent
                                || session.parent.as_deref() == Some(my_parent.as_str())
                        })
            })
            .map(|session| SessionSummary {
                session_id: session.id.clone(),
                provider: session.provider.clone(),
                title: session.title.clone(),
                parent: session.parent.clone(),
                status: match session.turn {
                    TurnState::Running => "running".to_string(),
                    TurnState::Idle => session
                        .last_result
                        .as_ref()
                        .map(|result| result.status.clone())
                        .unwrap_or_else(|| "idle".to_string()),
                },
                updated_at: session.updated_at.clone(),
            })
            .collect()
    }

    /// Spawn a headless child of `parent_id` and start it on `task`. Returns immediately.
    pub async fn spawn_child(
        self: &Arc<Self>,
        parent_id: &str,
        provider: Option<&str>,
        task: String,
        title: Option<String>,
        cwd: Option<PathBuf>,
    ) -> Result<HubSessionId> {
        let cwd = {
            let state = self.state.lock().await;
            let parent = state
                .sessions
                .get(parent_id)
                .ok_or_else(|| anyhow!("unknown session {parent_id}"))?;
            if parent.depth + 1 > self.config.children.max_depth {
                bail!(
                    "depth limit reached: this session is at depth {} and max_depth is {}",
                    parent.depth,
                    self.config.children.max_depth
                );
            }
            let live_children = parent
                .children
                .iter()
                .filter(|child| {
                    state
                        .sessions
                        .get(*child)
                        .is_some_and(|session| session.turn == TurnState::Running)
                })
                .count();
            if live_children >= self.config.children.max_children_per_session {
                bail!(
                    "this session already has {live_children} running children; await one before spawning more"
                );
            }
            cwd.unwrap_or_else(|| parent.cwd.clone())
        };
        let title = title.unwrap_or_else(|| first_line(&task));
        let child_id = self
            .create_session(
                provider,
                cwd,
                Some(parent_id.to_string()),
                Some(title.clone()),
            )
            .await?;
        let provider_name = {
            let state = self.state.lock().await;
            state
                .sessions
                .get(&child_id)
                .map(|session| session.provider.clone())
                .unwrap_or_default()
        };

        let tool_call = ToolCall::new(child_id.clone(), format!("{provider_name}: {title}"))
            .kind(ToolKind::Other)
            .status(ToolCallStatus::InProgress)
            .raw_input(serde_json::json!({
                "sessionId": child_id,
                "provider": provider_name,
                "task": task,
            }))
            .meta(child_meta(&child_id, &provider_name, parent_id));
        self.notify_upstream(SessionNotification::new(
            SessionId::new(parent_id.to_string()),
            SessionUpdate::ToolCall(tool_call),
        ))
        .await;

        let hub = self.clone();
        let id = child_id.clone();
        tokio::spawn(async move {
            let blocks = vec![ContentBlock::Text(TextContent::new(task))];
            if let Err(error) = hub.prompt(&id, blocks).await {
                tracing::warn!(session = %id, %error, "child turn failed");
            }
        });
        Ok(child_id)
    }

    /// Continue a child with a follow-up message. Returns immediately.
    pub async fn send_to_child(
        self: &Arc<Self>,
        caller: &str,
        child_id: &str,
        message: String,
    ) -> Result<()> {
        {
            let state = self.state.lock().await;
            let child = state
                .sessions
                .get(child_id)
                .ok_or_else(|| anyhow!("unknown session {child_id}"))?;
            if child.parent.as_deref() != Some(caller) {
                bail!("session {child_id} is not a child of the caller");
            }
            if child.turn == TurnState::Running {
                bail!("session {child_id} is still running; await it first");
            }
        }
        let hub = self.clone();
        let id = child_id.to_string();
        tokio::spawn(async move {
            let blocks = vec![ContentBlock::Text(TextContent::new(message))];
            if let Err(error) = hub.prompt(&id, blocks).await {
                tracing::warn!(session = %id, %error, "child follow-up failed");
            }
        });
        Ok(())
    }

    /// Wait for the session's in-flight turn, or return the last result right away.
    pub async fn await_turn(
        &self,
        caller: &str,
        id: &str,
        timeout: Duration,
    ) -> Result<Option<TurnResult>> {
        let receiver = {
            let mut state = self.state.lock().await;
            let session = state
                .sessions
                .get_mut(id)
                .ok_or_else(|| anyhow!("unknown session {id}"))?;
            if session.parent.as_deref() != Some(caller) && session.id != caller {
                bail!("session {id} is not a child of the caller");
            }
            match session.turn {
                TurnState::Idle => return Ok(session.last_result.clone()),
                TurnState::Running => {
                    let (tx, rx) = oneshot::channel();
                    session.waiters.push(tx);
                    rx
                }
            }
        };
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(result)) => Ok(Some(result)),
            Ok(Err(_)) => Ok(None),
            Err(_) => Ok(None),
        }
    }

    pub async fn send_message(&self, from: &str, to: &str, body: String) -> Result<AgentMessage> {
        let mut state = self.state.lock().await;
        let sender_parent = state
            .sessions
            .get(from)
            .ok_or_else(|| anyhow!("unknown sender session {from}"))?
            .parent
            .clone();
        let to = if to == "parent" {
            sender_parent
                .clone()
                .ok_or_else(|| anyhow!("this session has no parent"))?
        } else {
            to.to_string()
        };
        let recipient = state
            .sessions
            .get(&to)
            .ok_or_else(|| anyhow!("unknown recipient session {to}"))?;
        let allowed = recipient.parent.as_deref() == Some(from)
            || sender_parent.as_deref() == Some(to.as_str())
            || (sender_parent.is_some() && recipient.parent == sender_parent);
        if !allowed {
            bail!("messages may only go to a parent, a child, or a sibling");
        }
        let message = AgentMessage {
            id: uuid::Uuid::new_v4().to_string(),
            from: from.to_string(),
            to: to.clone(),
            body,
            created_at: now_iso(),
        };
        if let Some(recipient) = state.sessions.get_mut(&to) {
            recipient.inbox.push_back(message.clone());
            recipient.updated_at = now_iso();
        }
        Ok(message)
    }

    pub async fn drain_inbox(&self, id: &str) -> Vec<AgentMessage> {
        let mut state = self.state.lock().await;
        match state.sessions.get_mut(id) {
            Some(session) => session.inbox.drain(..).collect(),
            None => Vec::new(),
        }
    }

    pub async fn set_mode(&self, id: &str, mode_id: SessionModeId) -> Result<()> {
        let ds = self.downstream(id).await?;
        ds.cx
            .send_request(SetSessionModeRequest::new(ds.session_id.clone(), mode_id))
            .block_task()
            .await
            .map(|_| ())
            .map_err(|error| anyhow!("session/set_mode failed: {error}"))
    }
}

fn session_title(session: &Session) -> String {
    match &session.title {
        Some(title) => format!("{}: {title}", session.provider),
        None => session.provider.clone(),
    }
}

fn session_meta(session: &Session) -> serde_json::Map<String, serde_json::Value> {
    let value = serde_json::json!({
        "acp-hub": {
            "provider": session.provider,
            "parentSessionId": session.parent,
            "depth": session.depth,
            "createdAt": session.created_at,
        }
    });
    value.as_object().cloned().unwrap_or_default()
}

fn child_meta(
    child_id: &str,
    provider: &str,
    parent_id: &str,
) -> serde_json::Map<String, serde_json::Value> {
    let value = serde_json::json!({
        "acp-hub": {
            "childSessionId": child_id,
            "provider": provider,
            "parentSessionId": parent_id,
        }
    });
    value.as_object().cloned().unwrap_or_default()
}

fn first_line(text: &str) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    if line.chars().count() > 72 {
        let mut short: String = line.chars().take(69).collect();
        short.push_str("...");
        short
    } else {
        line.to_string()
    }
}
