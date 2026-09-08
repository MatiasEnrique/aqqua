//! Hub configuration: which ACP provider agents exist and how children behave.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    /// Provider used when a client does not name one.
    #[serde(default)]
    pub default_provider: Option<String>,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderConfig>,
    #[serde(default)]
    pub children: ChildPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    /// Shell-like command line that starts the provider's ACP agent over stdio.
    pub command: String,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Human-readable description shown to orchestrators through `list_providers`.
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChildPolicy {
    /// Headless children cannot ask a human, so permission requests are answered by policy.
    #[serde(default = "default_true")]
    pub auto_approve: bool,
    #[serde(default = "default_max_children")]
    pub max_children_per_session: usize,
    /// Depth limit counted from the root session. Root is depth 0.
    #[serde(default = "default_max_depth")]
    pub max_depth: usize,
}

impl Default for ChildPolicy {
    fn default() -> Self {
        Self {
            auto_approve: true,
            max_children_per_session: default_max_children(),
            max_depth: default_max_depth(),
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_max_children() -> usize {
    4
}

fn default_max_depth() -> usize {
    2
}

impl Config {
    pub fn default_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("acp-hub")
            .join("config.toml")
    }

    pub fn load(path: Option<&Path>) -> Result<(Self, PathBuf)> {
        let path = path
            .map(Path::to_path_buf)
            .unwrap_or_else(Self::default_path);
        if !path.exists() {
            return Ok((Self::starter(), path));
        }
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("reading config {}", path.display()))?;
        let config: Config =
            toml::from_str(&text).with_context(|| format!("parsing config {}", path.display()))?;
        Ok((config, path))
    }

    /// The configuration written by `acp-hub init`, and the fallback when no file exists.
    pub fn starter() -> Self {
        let mut providers = BTreeMap::new();
        providers.insert(
            "claude".to_string(),
            ProviderConfig {
                command: "npx -y @agentclientprotocol/claude-agent-acp@latest".to_string(),
                env: BTreeMap::new(),
                description: Some("Claude Code through the official ACP adapter".to_string()),
            },
        );
        providers.insert(
            "codex".to_string(),
            ProviderConfig {
                command: "npx -y @agentclientprotocol/codex-acp@latest".to_string(),
                env: BTreeMap::new(),
                description: Some("OpenAI Codex through the official ACP adapter".to_string()),
            },
        );
        Self {
            default_provider: Some("claude".to_string()),
            providers,
            children: ChildPolicy::default(),
        }
    }

    pub fn resolve_provider(&self, name: Option<&str>) -> Result<(String, ProviderConfig)> {
        let name = match name {
            Some(name) => name.to_string(),
            None => match &self.default_provider {
                Some(name) => name.clone(),
                None => match self.providers.keys().next() {
                    Some(first) => first.clone(),
                    None => bail!("no providers configured; run `acp-hub init`"),
                },
            },
        };
        match self.providers.get(&name) {
            Some(provider) => Ok((name, provider.clone())),
            None => bail!(
                "unknown provider `{name}`; configured providers: {}",
                self.providers
                    .keys()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
}
