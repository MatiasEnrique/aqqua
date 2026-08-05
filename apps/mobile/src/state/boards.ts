import { createEnvironmentBoardAtoms } from "@aqqua/client-runtime/state/boards";

import { environmentSnapshotAtom } from "./shell";

export const environmentBoards = createEnvironmentBoardAtoms({
  snapshotAtom: environmentSnapshotAtom,
});
