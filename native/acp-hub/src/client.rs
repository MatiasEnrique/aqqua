//! `acp-hub prompt`: a small ACP client for trying an agent command from a terminal.

use std::path::PathBuf;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, ListSessionsRequest, NewSessionRequest, PromptRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionNotification, SessionUpdate, TextContent,
};
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Client};
use anyhow::{Result, anyhow};

pub async fn run(
    config: AcpAgentConfig,
    cwd: PathBuf,
    prompts: Vec<String>,
    list: bool,
) -> Result<()> {
    let agent = AcpAgent::new(config);
    Client
        .builder()
        .name("acp-hub-prompt")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                print_update(&notification);
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                eprintln!(
                    "[permission] {} -> auto-approving",
                    request.tool_call.tool_call_id
                );
                let outcome = match request.options.first() {
                    Some(option) => RequestPermissionOutcome::Selected(
                        SelectedPermissionOutcome::new(option.option_id.clone()),
                    ),
                    None => RequestPermissionOutcome::Cancelled,
                };
                responder.respond(RequestPermissionResponse::new(outcome))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, async move |cx| {
            let init = cx
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            eprintln!(
                "[init] agent={} list_sessions={}",
                init.agent_info
                    .as_ref()
                    .map(|info| info.name.clone())
                    .unwrap_or_default(),
                init.agent_capabilities.session_capabilities.list.is_some()
            );
            let session = cx
                .send_request(NewSessionRequest::new(cwd))
                .block_task()
                .await?;
            eprintln!("[session] {}", session.session_id);
            for prompt in prompts {
                eprintln!("[prompt] {prompt}");
                let response = cx
                    .send_request(PromptRequest::new(
                        session.session_id.clone(),
                        vec![ContentBlock::Text(TextContent::new(prompt))],
                    ))
                    .block_task()
                    .await?;
                println!();
                eprintln!("[done] stop_reason={:?}", response.stop_reason);
            }
            if list {
                match cx
                    .send_request(ListSessionsRequest::new())
                    .block_task()
                    .await
                {
                    Ok(response) => {
                        for info in response.sessions {
                            eprintln!(
                                "[list] {} title={:?} updated={:?}",
                                info.session_id, info.title, info.updated_at
                            );
                        }
                    }
                    Err(error) => eprintln!("[list] unsupported: {error}"),
                }
            }
            Ok(())
        })
        .await
        .map_err(|error| anyhow!("{error}"))
}

fn print_update(notification: &SessionNotification) {
    use std::io::Write as _;
    match &notification.update {
        SessionUpdate::AgentMessageChunk(chunk) => {
            if let ContentBlock::Text(text) = &chunk.content {
                print!("{}", text.text);
                std::io::stdout().flush().ok();
            }
        }
        SessionUpdate::AgentThoughtChunk(_) => {}
        SessionUpdate::ToolCall(call) => {
            eprintln!(
                "[tool_call] session={} id={} title={:?} status={:?}",
                notification.session_id, call.tool_call_id, call.title, call.status
            );
        }
        SessionUpdate::ToolCallUpdate(update) => {
            eprintln!(
                "[tool_call_update] session={} id={} status={:?}",
                notification.session_id, update.tool_call_id, update.fields.status
            );
        }
        other => {
            eprintln!("[update] {}", update_name(other));
        }
    }
}

fn update_name(update: &SessionUpdate) -> &'static str {
    match update {
        SessionUpdate::UserMessageChunk(_) => "user_message_chunk",
        SessionUpdate::AgentMessageChunk(_) => "agent_message_chunk",
        SessionUpdate::AgentThoughtChunk(_) => "agent_thought_chunk",
        SessionUpdate::ToolCall(_) => "tool_call",
        SessionUpdate::ToolCallUpdate(_) => "tool_call_update",
        SessionUpdate::Plan(_) => "plan",
        SessionUpdate::AvailableCommandsUpdate(_) => "available_commands_update",
        SessionUpdate::CurrentModeUpdate(_) => "current_mode_update",
        SessionUpdate::ConfigOptionUpdate(_) => "config_option_update",
        SessionUpdate::SessionInfoUpdate(_) => "session_info_update",
        SessionUpdate::UsageUpdate(_) => "usage_update",
        _ => "other",
    }
}
