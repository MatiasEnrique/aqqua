//! The ACP agent the UI talks to over stdio.

use std::sync::Arc;

use agent_client_protocol::schema::v1::{
    AgentCapabilities, CancelNotification, Implementation, InitializeRequest, InitializeResponse,
    ListSessionsRequest, ListSessionsResponse, NewSessionRequest, NewSessionResponse,
    PromptRequest, SessionId, SessionListCapabilities, SetSessionModeRequest,
    SetSessionModeResponse,
};
use agent_client_protocol::{Agent, Stdio};
use anyhow::{Result, anyhow};

use crate::hub::Hub;

pub async fn run(hub: Arc<Hub>, default_provider: Option<String>) -> Result<()> {
    let new_session_hub = hub.clone();
    let prompt_hub = hub.clone();
    let cancel_hub = hub.clone();
    let list_hub = hub.clone();
    let mode_hub = hub.clone();
    let main_hub = hub.clone();

    Agent
        .builder()
        .name("acp-hub")
        .on_receive_request(
            async move |request: InitializeRequest, responder, _cx| {
                let mut capabilities = AgentCapabilities::new();
                capabilities.session_capabilities.list = Some(SessionListCapabilities::new());
                responder.respond(
                    InitializeResponse::new(request.protocol_version)
                        .agent_capabilities(capabilities)
                        .agent_info(Implementation::new("acp-hub", env!("CARGO_PKG_VERSION"))),
                )
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: NewSessionRequest, responder, cx| {
                let hub = new_session_hub.clone();
                let provider = provider_from_meta(&request).or_else(|| default_provider.clone());
                cx.spawn(async move {
                    let outcome = hub
                        .create_session(provider.as_deref(), request.cwd, None, None)
                        .await;
                    match outcome {
                        Ok(id) => responder.respond(NewSessionResponse::new(SessionId::new(id))),
                        Err(error) => responder.respond_with_internal_error(error.to_string()),
                    }
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: PromptRequest, responder, cx| {
                let hub = prompt_hub.clone();
                cx.spawn(async move {
                    let id = request.session_id.to_string();
                    match hub.prompt(&id, request.prompt).await {
                        Ok(response) => responder.respond(response),
                        Err(error) => responder.respond_with_internal_error(error.to_string()),
                    }
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_notification(
            async move |notification: CancelNotification, cx| {
                let hub = cancel_hub.clone();
                cx.spawn(async move {
                    let id = notification.session_id.to_string();
                    if let Err(error) = hub.cancel(&id).await {
                        tracing::debug!(%error, "cancel ignored");
                    }
                    Ok(())
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |_request: ListSessionsRequest, responder, cx| {
                let hub = list_hub.clone();
                cx.spawn(async move {
                    let sessions = hub.list_sessions().await;
                    responder.respond(ListSessionsResponse::new(sessions))
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: SetSessionModeRequest, responder, cx| {
                let hub = mode_hub.clone();
                cx.spawn(async move {
                    let id = request.session_id.to_string();
                    match hub.set_mode(&id, request.mode_id).await {
                        Ok(()) => responder.respond(SetSessionModeResponse::new()),
                        Err(error) => responder.respond_with_internal_error(error.to_string()),
                    }
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(Stdio::new(), async move |cx| {
            main_hub.set_upstream(cx.clone()).await;
            cx.incoming_closed().await;
            Ok(())
        })
        .await
        .map_err(|error| anyhow!("upstream connection failed: {error}"))
}

fn provider_from_meta(request: &NewSessionRequest) -> Option<String> {
    let meta = request.meta.as_ref()?;
    let nested = meta
        .get("acp-hub")
        .and_then(|value| value.get("provider"))
        .and_then(|value| value.as_str());
    nested
        .or_else(|| meta.get("provider").and_then(|value| value.as_str()))
        .map(str::to_string)
}
