//! One provider process per hub session, driven as an ACP client.

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    InitializeRequest, McpServer, McpServerStdio, NewSessionRequest, RequestPermissionRequest,
    SessionNotification,
};
use agent_client_protocol::{AcpAgent, Client, ConnectionTo};
use anyhow::{Context, Result, anyhow};
use tokio::sync::oneshot;

use crate::config::ProviderConfig;
use crate::hub::{Downstream, Hub, HubSessionId};

pub async fn spawn(
    hub: Arc<Hub>,
    hub_id: HubSessionId,
    provider_name: String,
    provider: ProviderConfig,
    cwd: PathBuf,
) -> Result<Downstream> {
    let agent = AcpAgent::from_str(&provider.command)
        .with_context(|| format!("invalid command for provider {provider_name}"))?;
    let config = agent.into_config().envs(provider.env.clone());
    let agent = AcpAgent::new(config);

    let (ready_tx, ready_rx) = oneshot::channel::<Result<Downstream>>();
    let mcp_server = McpServer::Stdio(McpServerStdio::new("acp-hub", hub.exe.clone()).args(vec![
        "mcp".to_string(),
        "--socket".to_string(),
        hub.socket_path.display().to_string(),
        "--session".to_string(),
        hub_id.clone(),
    ]));

    let notify_hub = hub.clone();
    let notify_id = hub_id.clone();
    let permission_hub = hub.clone();
    let permission_id = hub_id.clone();
    let close_hub = hub.clone();
    let close_id = hub_id.clone();
    let name = format!("acp-hub/{provider_name}");

    tokio::spawn(async move {
        let outcome = Client
            .builder()
            .name(name)
            .on_receive_notification(
                async move |notification: SessionNotification, _cx| {
                    notify_hub
                        .on_downstream_notification(&notify_id, notification)
                        .await;
                    Ok(())
                },
                agent_client_protocol::on_receive_notification!(),
            )
            .on_receive_request(
                async move |request: RequestPermissionRequest, responder, _cx| {
                    permission_hub
                        .on_permission_request(&permission_id, request, responder)
                        .await
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_with(
                agent,
                async move |cx: ConnectionTo<agent_client_protocol::Agent>| {
                    let setup = async {
                        cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                            .block_task()
                            .await
                            .map_err(|error| anyhow!("initialize failed: {error}"))?;
                        let response = cx
                            .send_request(NewSessionRequest::new(cwd).mcp_servers(vec![mcp_server]))
                            .block_task()
                            .await
                            .map_err(|error| anyhow!("session/new failed: {error}"))?;
                        Ok::<Downstream, anyhow::Error>(Downstream {
                            cx: cx.clone(),
                            session_id: response.session_id,
                        })
                    }
                    .await;
                    let failed = setup.is_err();
                    let _ = ready_tx.send(setup);
                    if failed {
                        return Ok(());
                    }
                    cx.incoming_closed().await;
                    Ok(())
                },
            )
            .await;
        if let Err(error) = outcome {
            tracing::warn!(session = %close_id, %error, "provider connection ended with error");
        }
        close_hub.on_downstream_closed(&close_id).await;
    });

    ready_rx
        .await
        .map_err(|_| anyhow!("provider {provider_name} exited before its session was ready"))?
}
