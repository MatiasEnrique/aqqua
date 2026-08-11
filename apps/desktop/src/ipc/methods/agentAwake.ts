import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ElectronPowerSaveBlocker from "../../electron/ElectronPowerSaveBlocker.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const setAgentAwake = DesktopIpc.makeSenderIpcMethod({
  channel: IpcChannels.SET_AGENT_AWAKE_CHANNEL,
  payload: Schema.Struct({
    active: Schema.Boolean,
    releaseOrphans: Schema.Boolean,
  }),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.agentAwake.set")(function* (report, event) {
    const blocker = yield* ElectronPowerSaveBlocker.ElectronPowerSaveBlocker;
    yield* blocker.setAgentActive(event.sender, report.active, {
      releaseOrphans: report.releaseOrphans,
    });
  }),
});
