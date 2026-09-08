//! MCP tools every provider session receives. The caller identity is the hub session that
//! launched the shim, never something the model supplies.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock, ServerCapabilities, ServerInfo};
use rmcp::{ErrorData as McpError, ServerHandler, schemars, tool, tool_handler, tool_router};
use serde::Deserialize;

use crate::hub::Hub;

#[derive(Clone)]
pub struct HubTools {
    hub: Arc<Hub>,
    caller: String,
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SpawnAgentParams {
    /// Provider name from `list_providers`. Omit to use the hub default.
    pub provider: Option<String>,
    /// The full task for the sub-agent. It starts working immediately.
    pub task: String,
    /// Short label shown in UIs. Defaults to the first line of the task.
    pub title: Option<String>,
    /// Absolute working directory. Defaults to the caller's directory.
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SessionParams {
    pub session_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AwaitAgentParams {
    pub session_id: String,
    /// Seconds to wait before returning `running`. Defaults to 300.
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SendAgentParams {
    pub session_id: String,
    /// Follow-up instruction for a sub-agent that has finished its previous turn.
    pub message: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SendMessageParams {
    /// Recipient session id, or the literal `parent`.
    pub to: String,
    pub body: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct EmptyParams {}

fn json_result(value: serde_json::Value) -> Result<CallToolResult, McpError> {
    let text = serde_json::to_string_pretty(&value)
        .map_err(|error| McpError::internal_error(error.to_string(), None))?;
    Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
}

fn failure(error: anyhow::Error) -> Result<CallToolResult, McpError> {
    Ok(CallToolResult::error(vec![ContentBlock::text(
        error.to_string(),
    )]))
}

#[tool_router]
impl HubTools {
    pub fn new(hub: Arc<Hub>, caller: String) -> Self {
        Self {
            hub,
            caller,
            tool_router: Self::tool_router(),
        }
    }

    #[tool(description = "List the agent providers this hub can spawn sub-agents on.")]
    async fn list_providers(
        &self,
        Parameters(_): Parameters<EmptyParams>,
    ) -> Result<CallToolResult, McpError> {
        let providers: Vec<serde_json::Value> = self
            .hub
            .config
            .providers
            .iter()
            .map(|(name, provider)| {
                serde_json::json!({
                    "name": name,
                    "description": provider.description,
                    "default": self.hub.config.default_provider.as_deref() == Some(name.as_str()),
                })
            })
            .collect();
        json_result(serde_json::json!({ "providers": providers }))
    }

    #[tool(
        description = "Spawn a headless sub-agent on any provider and start it on a task. Returns immediately with its session_id; use await_agent to collect the result."
    )]
    async fn spawn_agent(
        &self,
        Parameters(params): Parameters<SpawnAgentParams>,
    ) -> Result<CallToolResult, McpError> {
        let cwd = params.cwd.map(PathBuf::from);
        match self
            .hub
            .spawn_child(
                &self.caller,
                params.provider.as_deref(),
                params.task,
                params.title,
                cwd,
            )
            .await
        {
            Ok(session_id) => json_result(serde_json::json!({
                "session_id": session_id,
                "status": "running",
                "next": "call await_agent with this session_id",
            })),
            Err(error) => failure(error),
        }
    }

    #[tool(
        description = "Wait for a sub-agent's current turn to finish and return its final message. Returns status running if the timeout elapses; call again to keep waiting."
    )]
    async fn await_agent(
        &self,
        Parameters(params): Parameters<AwaitAgentParams>,
    ) -> Result<CallToolResult, McpError> {
        let timeout = Duration::from_secs(params.timeout_secs.unwrap_or(300).clamp(1, 3600));
        match self
            .hub
            .await_turn(&self.caller, &params.session_id, timeout)
            .await
        {
            Ok(Some(result)) => json_result(serde_json::json!({
                "session_id": params.session_id,
                "status": result.status,
                "stop_reason": result.stop_reason,
                "final_message": result.final_message,
            })),
            Ok(None) => json_result(serde_json::json!({
                "session_id": params.session_id,
                "status": "running",
            })),
            Err(error) => failure(error),
        }
    }

    #[tool(
        description = "Send a follow-up instruction to one of your sub-agents, keeping its context. Returns immediately."
    )]
    async fn send_agent(
        &self,
        Parameters(params): Parameters<SendAgentParams>,
    ) -> Result<CallToolResult, McpError> {
        match self
            .hub
            .send_to_child(&self.caller, &params.session_id, params.message)
            .await
        {
            Ok(()) => json_result(
                serde_json::json!({ "session_id": params.session_id, "status": "running" }),
            ),
            Err(error) => failure(error),
        }
    }

    #[tool(
        description = "List your parent, your sub-agents, and your siblings with their current status."
    )]
    async fn list_agents(
        &self,
        Parameters(_): Parameters<EmptyParams>,
    ) -> Result<CallToolResult, McpError> {
        let sessions = self.hub.summaries_for(&self.caller).await;
        json_result(serde_json::json!({ "self": self.caller, "agents": sessions }))
    }

    #[tool(
        description = "Leave a message for another agent: your parent (to = \"parent\"), a sub-agent, or a sibling. Messages wait in the recipient's inbox until it reads them."
    )]
    async fn send_message(
        &self,
        Parameters(params): Parameters<SendMessageParams>,
    ) -> Result<CallToolResult, McpError> {
        match self
            .hub
            .send_message(&self.caller, &params.to, params.body)
            .await
        {
            Ok(message) => json_result(serde_json::json!({ "delivered": message })),
            Err(error) => failure(error),
        }
    }

    #[tool(description = "Read and clear your inbox of messages from other agents.")]
    async fn inbox(
        &self,
        Parameters(_): Parameters<EmptyParams>,
    ) -> Result<CallToolResult, McpError> {
        let messages = self.hub.drain_inbox(&self.caller).await;
        json_result(serde_json::json!({ "messages": messages }))
    }

    #[tool(description = "Interrupt a running sub-agent.")]
    async fn cancel_agent(
        &self,
        Parameters(params): Parameters<SessionParams>,
    ) -> Result<CallToolResult, McpError> {
        match self.hub.cancel(&params.session_id).await {
            Ok(()) => json_result(
                serde_json::json!({ "session_id": params.session_id, "status": "cancelling" }),
            ),
            Err(error) => failure(error),
        }
    }
}

#[tool_handler]
impl ServerHandler for HubTools {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.instructions = Some(
            "acp-hub lets you delegate work to headless sub-agents on other providers and exchange messages with them. \
             Spawn with spawn_agent, collect with await_agent, coordinate with send_message and inbox."
                .to_string(),
        );
        info
    }
}
