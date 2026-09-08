//! `acp-hub test-agent`: a scripted ACP provider used to exercise the hub end to end.
//!
//! On every prompt it connects to the MCP server the hub handed it in `session/new`, spawns
//! a sub-agent on the provider named by the prompt (default `echo`), awaits it, exchanges a
//! message with the child, and streams what happened back as assistant text. No model involved.
//! With `--echo` it only echoes its prompt, which makes it a dependency-free child provider.

use std::sync::Arc;

use agent_client_protocol::schema::v1::{
    AgentCapabilities, ContentBlock, ContentChunk, Implementation, InitializeRequest,
    InitializeResponse, McpServer, NewSessionRequest, NewSessionResponse, PromptRequest,
    PromptResponse, SessionId, SessionNotification, SessionUpdate, StopReason, TextContent,
};
use agent_client_protocol::{Agent, Client, ConnectionTo, Stdio};
use anyhow::{Context, Result, anyhow};
use rmcp::ServiceExt;
use rmcp::model::CallToolRequestParams;
use rmcp::transport::TokioChildProcess;
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Default)]
struct State {
    mcp: Vec<McpServer>,
}

pub async fn run(echo: bool) -> Result<()> {
    let state = Arc::new(Mutex::new(State::default()));
    let new_state = state.clone();
    let prompt_state = state.clone();
    Agent
        .builder()
        .name("acp-hub-test-agent")
        .on_receive_request(
            async move |request: InitializeRequest, responder, _cx| {
                responder.respond(
                    InitializeResponse::new(request.protocol_version)
                        .agent_capabilities(AgentCapabilities::new())
                        .agent_info(Implementation::new("acp-hub-test-agent", "0")),
                )
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: NewSessionRequest, responder, _cx| {
                new_state.lock().await.mcp = request.mcp_servers;
                responder.respond(NewSessionResponse::new(SessionId::new(
                    "test-agent-session",
                )))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: PromptRequest, responder, cx| {
                let state = prompt_state.clone();
                let task_cx = cx.clone();
                cx.spawn(async move {
                    let session_id = request.session_id.clone();
                    let prompt_text = request
                        .prompt
                        .iter()
                        .filter_map(|block| match block {
                            ContentBlock::Text(text) => Some(text.text.clone()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    if echo {
                        say(&task_cx, &session_id, &format!("echo: {prompt_text}"));
                        return responder.respond(PromptResponse::new(StopReason::EndTurn));
                    }
                    let servers = state.lock().await.mcp.clone();
                    let outcome = orchestrate(&task_cx, &session_id, servers, &prompt_text).await;
                    if let Err(error) = &outcome {
                        say(
                            &task_cx,
                            &session_id,
                            &format!("test-agent error: {error}\n"),
                        );
                    }
                    responder.respond(PromptResponse::new(StopReason::EndTurn))
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_to(Stdio::new())
        .await
        .map_err(|error| anyhow!("{error}"))
}

fn say(cx: &ConnectionTo<Client>, session_id: &SessionId, text: &str) {
    let _ = cx.send_notification(SessionNotification::new(
        session_id.clone(),
        SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(TextContent::new(
            text,
        )))),
    ));
}

async fn orchestrate(
    cx: &ConnectionTo<Client>,
    session_id: &SessionId,
    servers: Vec<McpServer>,
    prompt: &str,
) -> Result<()> {
    let stdio = servers
        .into_iter()
        .find_map(|server| match server {
            McpServer::Stdio(stdio) if stdio.name == "acp-hub" => Some(stdio),
            _ => None,
        })
        .ok_or_else(|| anyhow!("hub did not attach its MCP server"))?;
    say(cx, session_id, "connecting to hub tools\n");
    let mut command = Command::new(&stdio.command);
    command.args(&stdio.args);
    for env in &stdio.env {
        command.env(&env.name, &env.value);
    }
    let transport = TokioChildProcess::new(command).context("spawning MCP shim")?;
    let client = ().serve(transport).await.context("MCP initialize")?;

    let tools = client.list_tools(Default::default()).await?;
    let names: Vec<&str> = tools.tools.iter().map(|tool| tool.name.as_ref()).collect();
    say(cx, session_id, &format!("tools: {}\n", names.join(", ")));

    let provider = prompt
        .split_whitespace()
        .find_map(|word| word.strip_prefix("provider="))
        .unwrap_or("echo")
        .to_string();

    let spawn = call(
        &client,
        "spawn_agent",
        serde_json::json!({
            "provider": provider,
            "task": format!("child task from test-agent: {prompt}"),
            "title": "test child",
        }),
    )
    .await?;
    let child_id = spawn["session_id"]
        .as_str()
        .ok_or_else(|| anyhow!("spawn_agent returned no session_id: {spawn}"))?
        .to_string();
    say(
        cx,
        session_id,
        &format!("spawned child {child_id} on {provider}\n"),
    );

    let awaited = call(
        &client,
        "await_agent",
        serde_json::json!({ "session_id": child_id, "timeout_secs": 30 }),
    )
    .await?;
    say(
        cx,
        session_id,
        &format!(
            "child finished: status={} final_message={:?}\n",
            awaited["status"], awaited["final_message"]
        ),
    );

    call(
        &client,
        "send_message",
        serde_json::json!({ "to": child_id, "body": "thanks" }),
    )
    .await?;
    let agents = call(&client, "list_agents", serde_json::json!({})).await?;
    say(
        cx,
        session_id,
        &format!(
            "agents: {}\n",
            agents["agents"].as_array().map(|a| a.len()).unwrap_or(0)
        ),
    );
    let inbox = call(&client, "inbox", serde_json::json!({})).await?;
    say(cx, session_id, &format!("inbox: {}\n", inbox["messages"]));

    client.cancel().await.ok();
    Ok(())
}

async fn call(
    client: &rmcp::service::RunningService<rmcp::RoleClient, ()>,
    name: &'static str,
    arguments: serde_json::Value,
) -> Result<serde_json::Value> {
    let result = client
        .call_tool(
            CallToolRequestParams::new(name)
                .with_arguments(arguments.as_object().cloned().unwrap_or_default()),
        )
        .await
        .with_context(|| format!("calling {name}"))?;
    let text = result
        .content
        .iter()
        .filter_map(|block| block.as_text().map(|text| text.text.clone()))
        .collect::<Vec<_>>()
        .join("\n");
    if result.is_error.unwrap_or(false) {
        return Err(anyhow!("{name} failed: {text}"));
    }
    serde_json::from_str(&text).with_context(|| format!("{name} returned non-JSON: {text}"))
}
