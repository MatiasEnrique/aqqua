import {
  AQQUA_PROJECT_FILE_NAME,
  type EnvironmentId,
  type AqquaProjectFileScript,
} from "@aqqua/contracts";
import { AqquaProjectFileFromJson } from "@aqqua/shared/aqquaProjectFile";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const decodeAqquaProjectFile = Schema.decodeExit(AqquaProjectFileFromJson);

const NO_SCRIPTS: ReadonlyArray<AqquaProjectFileScript> = [];

/**
 * Scripts declared in the project's checked-in `aqqua.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useAqquaProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<AqquaProjectFileScript> {
  const query = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    AQQUA_PROJECT_FILE_NAME,
    cwd !== null,
  );
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  return useMemo(() => {
    if (contents === null) return NO_SCRIPTS;
    const decoded = decodeAqquaProjectFile(contents);
    if (Exit.isFailure(decoded)) return NO_SCRIPTS;
    return decoded.value.scripts ?? NO_SCRIPTS;
  }, [contents]);
}
