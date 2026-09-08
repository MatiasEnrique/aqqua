//! End-to-end: a UI client talks to the hub, the hub runs a scripted orchestrator provider,
//! the orchestrator spawns a child on a second provider through the hub's MCP tools, and the
//! child's lifecycle is projected back into the parent session.

use std::path::PathBuf;
use std::process::Command;

fn hub() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_acp-hub"))
}

fn write_config(dir: &std::path::Path) -> PathBuf {
    let path = dir.join("config.toml");
    let exe = hub().display().to_string();
    let config = format!(
        r#"default_provider = "echo"

[providers.echo]
command = "{exe} --config {config} test-agent --echo"

[providers.test]
command = "{exe} --config {config} test-agent"
"#,
        config = path.display()
    );
    std::fs::write(&path, config).unwrap();
    path
}

#[test]
fn orchestrator_spawns_child_and_hub_projects_it() {
    let dir = std::env::temp_dir().join(format!("acp-hub-e2e-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let config = write_config(&dir);

    let output = Command::new(hub())
        .arg("--config")
        .arg(&config)
        .args(["prompt", "--list", "--provider", "test", "--cwd"])
        .arg(&dir)
        .arg("delegate this provider=echo")
        .output()
        .expect("run acp-hub prompt");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let all = format!("{stdout}\n{stderr}");

    assert!(output.status.success(), "acp-hub prompt failed:\n{all}");
    assert!(all.contains("tools: await_agent, cancel_agent, inbox, list_agents, list_providers, send_agent, send_message, spawn_agent"), "{all}");
    assert!(
        all.contains("[tool_call] session="),
        "child was not projected as a tool call:\n{all}"
    );
    assert!(
        all.contains("title=\"echo: test child\" status=InProgress"),
        "{all}"
    );
    assert!(
        all.contains("status=Some(Completed)"),
        "child completion was not projected:\n{all}"
    );
    assert!(
        all.contains("child finished: status=\"completed\" final_message=String(\"echo: child task from test-agent: delegate this provider=echo\")"),
        "child final message missing:\n{all}"
    );
    assert!(all.contains("agents: 2"), "{all}");
    assert_eq!(
        all.matches("[list] ").count(),
        2,
        "session/list should show root and child:\n{all}"
    );
    assert!(all.contains("title=Some(\"echo: test child\")"), "{all}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn root_session_passthrough_and_list() {
    let dir = std::env::temp_dir().join(format!("acp-hub-e2e-root-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let config = write_config(&dir);

    let output = Command::new(hub())
        .arg("--config")
        .arg(&config)
        .args(["prompt", "--list", "--cwd"])
        .arg(&dir)
        .arg("hello")
        .output()
        .expect("run acp-hub prompt");
    let all = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.status.success(), "{all}");
    assert!(all.contains("echo: hello"), "{all}");
    assert!(
        all.contains("[init] agent=acp-hub list_sessions=true"),
        "{all}"
    );
    assert_eq!(all.matches("[list] ").count(), 1, "{all}");

    std::fs::remove_dir_all(&dir).ok();
}
