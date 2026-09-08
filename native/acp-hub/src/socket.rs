//! Unix socket that MCP shims connect to. Each connection serves the hub's tools for one session.

use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use rmcp::ServiceExt;
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::UnixListener;

use crate::hub::Hub;
use crate::tools::HubTools;

#[derive(Deserialize)]
struct Handshake {
    session: String,
}

pub async fn serve(hub: Arc<Hub>, path: &Path) -> Result<()> {
    if path.exists() {
        std::fs::remove_file(path).ok();
    }
    let listener =
        UnixListener::bind(path).with_context(|| format!("binding {}", path.display()))?;
    tracing::info!(socket = %path.display(), "tool socket listening");
    loop {
        let (stream, _) = listener.accept().await?;
        let hub = hub.clone();
        tokio::spawn(async move {
            if let Err(error) = handle(hub, stream).await {
                tracing::debug!(%error, "tool connection ended");
            }
        });
    }
}

async fn handle(hub: Arc<Hub>, stream: tokio::net::UnixStream) -> Result<()> {
    let (read_half, write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    let mut line = String::new();
    reader.read_line(&mut line).await?;
    let handshake: Handshake = serde_json::from_str(line.trim()).context("bad shim handshake")?;
    tracing::debug!(session = %handshake.session, "tool connection opened");
    let service = HubTools::new(hub, handshake.session)
        .serve((reader, write_half))
        .await
        .context("starting MCP service")?;
    service.waiting().await.context("MCP service")?;
    Ok(())
}
