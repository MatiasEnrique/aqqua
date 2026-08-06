import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject, EnvironmentThreadShell } from "@aqqua/client-runtime/state/shell";
import type {
  EnvironmentId,
  ProjectIcon,
  ScopedProjectRef,
  ScopedThreadRef,
  ServerConfig,
} from "@aqqua/contracts";
import { Atom } from "effect/unstable/reactivity";

import { environmentProjects } from "./projects";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";
import { environmentThreadShells } from "./threads";

const EMPTY_PROJECT_ATOM = Atom.make<EnvironmentProject | null>(null).pipe(
  Atom.withLabel("mobile-project:empty"),
);
const EMPTY_THREAD_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null).pipe(
  Atom.withLabel("mobile-thread-shell:empty"),
);
const EMPTY_SERVER_CONFIG_ATOM = Atom.make<ServerConfig | null>(null).pipe(
  Atom.withLabel("mobile-server-config:empty"),
);

export function useProjects(): ReadonlyArray<EnvironmentProject> {
  return useAtomValue(environmentProjects.projectsAtom);
}

const EMPTY_PROJECT_ICON_ATOM = Atom.make<ProjectIcon | null>(null).pipe(
  Atom.withLabel("mobile-project-icon:empty"),
);

/**
 * The icon a user chose for the project rooted at `workspaceRoot`, or `null`
 * when the project falls back to favicon discovery.
 */
export function useProjectIcon(
  environmentId: EnvironmentId,
  workspaceRoot: string | null | undefined,
): ProjectIcon | null {
  return useAtomValue(
    workspaceRoot === null || workspaceRoot === undefined
      ? EMPTY_PROJECT_ICON_ATOM
      : environmentProjects.projectIconAtom({ environmentId, workspaceRoot }),
  );
}

export function useThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(environmentThreadShells.threadShellsAtom);
}

export function useProject(ref: ScopedProjectRef | null): EnvironmentProject | null {
  return useAtomValue(ref === null ? EMPTY_PROJECT_ATOM : environmentProjects.projectAtom(ref));
}

export function useThreadShell(ref: ScopedThreadRef | null): EnvironmentThreadShell | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : environmentThreadShells.threadShellAtom(ref),
  );
}

export function useEnvironmentServerConfig(
  environmentId: EnvironmentId | null,
): ServerConfig | null {
  return useAtomValue(
    environmentId === null
      ? EMPTY_SERVER_CONFIG_ATOM
      : serverEnvironment.configValueAtom(environmentId),
  );
}

export function useServerConfigs(): ReadonlyMap<EnvironmentId, ServerConfig> {
  return useAtomValue(environmentServerConfigsAtom);
}
