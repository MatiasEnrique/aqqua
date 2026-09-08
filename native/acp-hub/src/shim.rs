//! `acp-hub mcp`: the stdio MCP server a provider agent launches. It is a byte pipe to the hub's
//! unix socket, prefixed by a one-line handshake naming the session it belongs to.

use std::path::Path;

use anyhow::{Context, Result};
use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;

pub async fn run(socket: &Path, session: &str) -> Result<()> {
    let mut stream = UnixStream::connect(socket)
        .await
        .with_context(|| format!("connecting to hub socket {}", socket.display()))?;
    let handshake = serde_json::json!({ "session": session });
    stream
        .write_all(format!("{handshake}\n").as_bytes())
        .await?;
    let (mut socket_read, mut socket_write) = stream.into_split();
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    tokio::select! {
        result = tokio::io::copy(&mut stdin, &mut socket_write) => {
            result.context("stdin to hub")?;
        }
        result = tokio::io::copy(&mut socket_read, &mut stdout) => {
            result.context("hub to stdout")?;
        }
    }
    stdout.flush().await.ok();
    Ok(())
}
