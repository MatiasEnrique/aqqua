import { createFileRoute } from "@tanstack/react-router";

import { AgentProfilesSettingsPanel } from "../components/settings/AgentProfilesSettings";

function SettingsAgentProfilesRoute() {
  return <AgentProfilesSettingsPanel />;
}

export const Route = createFileRoute("/settings/agent-profiles")({
  component: SettingsAgentProfilesRoute,
});
