import { useAtomValue } from "@effect/atom-react";
import { createAssetEnvironmentAtoms, resolveAssetUrl } from "@aqqua/client-runtime/state/assets";
import type { AssetResource, EnvironmentId } from "@aqqua/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atom-registry";
import { usePreparedConnection } from "./session";

export const assetEnvironment = createAssetEnvironmentAtoms(connectionAtomRuntime);

export type AssetUrlState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failure"; readonly retry: () => void }
  | { readonly _tag: "Success"; readonly url: string };

const EMPTY_ASSET_URL_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("mobile-asset-url:empty"),
);

export function useAssetUrlState(
  environmentId: EnvironmentId | null,
  resource: AssetResource | null,
): AssetUrlState {
  const preparedConnection = usePreparedConnection(environmentId);
  const urlAtom =
    environmentId === null || resource === null
      ? EMPTY_ASSET_URL_ATOM
      : assetEnvironment.createUrl({ environmentId, input: { resource } });
  const result = useAtomValue(urlAtom);
  const retry = useCallback(() => {
    appAtomRegistry.refresh(urlAtom);
  }, [urlAtom]);
  if (result._tag === "Failure") {
    return { _tag: "Failure", retry };
  }
  if (preparedConnection._tag === "None" || result._tag !== "Success") {
    return { _tag: "Loading" };
  }
  const url = resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl);
  return url === null ? { _tag: "Failure", retry } : { _tag: "Success", url };
}

export function useAssetUrl(
  environmentId: EnvironmentId | null,
  resource: AssetResource | null,
): string | null {
  const state = useAssetUrlState(environmentId, resource);
  return state._tag === "Success" ? state.url : null;
}
