import * as Schema from "effect/Schema";

export class AgentCliError extends Schema.TaggedErrorClass<AgentCliError>()("AgentCliError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
