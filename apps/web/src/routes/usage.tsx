import { createFileRoute } from "@tanstack/react-router";
import { UsagePane } from "../components/usage/UsagePane";

export const Route = createFileRoute("/usage")({
  component: UsagePane,
});
