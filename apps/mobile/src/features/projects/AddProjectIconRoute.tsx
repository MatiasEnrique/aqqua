import type { StaticScreenProps } from "@react-navigation/native";

import { AddProjectIconScreen } from "./AddProjectScreen";

type AddProjectIconRouteParams = {
  readonly environmentId: string;
  readonly workspaceRoot: string;
  readonly remoteUrl?: string;
};

export function AddProjectIconRoute({ route }: StaticScreenProps<AddProjectIconRouteParams>) {
  return <AddProjectIconScreen {...route.params} />;
}
