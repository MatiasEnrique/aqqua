//! acp-hub: a provider-agnostic Agent Client Protocol hub.
//!
//! ACP UIs launch `acp-hub acp` as their agent. The hub spawns provider agents such as Claude
//! or Codex through their own ACP adapters, lets any session spawn headless sub-agents on any
//! provider, and gives agents a mailbox to talk to each other.

mod client;
mod config;
mod downstream;
mod hub;
mod shim;
mod socket;
mod test_agent;
mod tools;
mod upstream;

use std::path::PathBuf;

use agent_client_protocol::AcpAgentConfig;
use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};

use crate::config::Config;

#[derive(Parser)]
#[command(
    name = "acp-hub",
    version,
    about = "Provider-agnostic ACP hub for orchestrating agents"
)]
struct Cli {
    /// Path to config.toml. Defaults to the platform config directory.
    #[arg(long, global = true)]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run as an ACP agent over stdio. This is what ACP UIs launch.
    Acp {
        /// Provider for sessions that do not name one. Overrides the config default.
        #[arg(long)]
        provider: Option<String>,
    },
    /// Internal: MCP stdio shim launched by provider agents.
    #[command(hide = true)]
    Mcp {
        #[arg(long)]
        socket: PathBuf,
        #[arg(long)]
        session: String,
    },
    /// Internal: scripted ACP provider that exercises the hub tools. Used by tests.
    #[command(hide = true)]
    TestAgent {
        /// Only echo prompts instead of orchestrating.
        #[arg(long)]
        echo: bool,
    },
    /// Write a starter config with Claude and Codex providers.
    Init {
        #[arg(long)]
        force: bool,
    },
    /// List configured providers.
    Providers,
    /// Send one or more prompts to an ACP agent from the terminal. Defaults to this hub.
    Prompt {
        /// Agent command line, for example "npx -y @agentclientprotocol/codex-acp@latest".
        #[arg(long)]
        command: Option<String>,
        /// Provider for the hub when no explicit command is given.
        #[arg(long)]
        provider: Option<String>,
        #[arg(long)]
        cwd: Option<PathBuf>,
        /// Also call session/list after the prompts.
        #[arg(long)]
        list: bool,
        #[arg(required = true)]
        prompts: Vec<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("acp_hub=info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();
    let (config, config_path) = Config::load(cli.config.as_deref())?;

    match cli.command {
        Command::Acp { provider } => run_acp(config, provider).await,
        Command::Mcp { socket, session } => shim::run(&socket, &session).await,
        Command::TestAgent { echo } => test_agent::run(echo).await,
        Command::Init { force } => {
            if config_path.exists() && !force {
                bail!(
                    "{} already exists; pass --force to overwrite",
                    config_path.display()
                );
            }
            if let Some(parent) = config_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&config_path, toml::to_string_pretty(&Config::starter())?)?;
            eprintln!("wrote {}", config_path.display());
            Ok(())
        }
        Command::Providers => {
            if config.providers.is_empty() {
                eprintln!("no providers configured; run `acp-hub init`");
            }
            for (name, provider) in &config.providers {
                let marker = if config.default_provider.as_deref() == Some(name) {
                    "*"
                } else {
                    " "
                };
                println!("{marker} {name:<12} {}", provider.command);
            }
            Ok(())
        }
        Command::Prompt {
            command,
            provider,
            cwd,
            list,
            prompts,
        } => {
            let agent = match command {
                Some(command) => agent_client_protocol::AcpAgent::from_str_config(&command)?,
                None => {
                    let mut agent = AcpAgentConfig::new(std::env::current_exe()?);
                    if let Some(path) = &cli.config {
                        agent = agent.arg("--config").arg(path.display().to_string());
                    }
                    agent = agent.arg("acp");
                    if let Some(provider) = provider {
                        agent = agent.arg("--provider").arg(provider);
                    }
                    agent
                }
            };
            let cwd = match cwd {
                Some(cwd) => cwd,
                None => std::env::current_dir()?,
            };
            client::run(agent, cwd, prompts, list).await
        }
    }
}

async fn run_acp(config: Config, provider: Option<String>) -> Result<()> {
    if let Some(name) = &provider {
        config.resolve_provider(Some(name))?;
    }
    let exe = std::env::current_exe().context("locating acp-hub executable")?;
    let socket_path = std::env::temp_dir().join(format!("acp-hub-{}.sock", std::process::id()));
    let hub = hub::Hub::new(config, socket_path.clone(), exe);

    let socket_hub = hub.clone();
    let socket_task = tokio::spawn(async move { socket::serve(socket_hub, &socket_path).await });

    let result = upstream::run(hub.clone(), provider).await;
    socket_task.abort();
    std::fs::remove_file(&hub.socket_path).ok();
    result
}

trait FromStrConfig {
    fn from_str_config(command: &str) -> Result<AcpAgentConfig>;
}

impl FromStrConfig for agent_client_protocol::AcpAgent {
    fn from_str_config(command: &str) -> Result<AcpAgentConfig> {
        use std::str::FromStr as _;
        let agent = agent_client_protocol::AcpAgent::from_str(command)
            .map_err(|error| anyhow::anyhow!("invalid agent command: {error}"))?;
        Ok(agent.into_config())
    }
}
