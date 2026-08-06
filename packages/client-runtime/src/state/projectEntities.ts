import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationShellSnapshot,
  ProjectIcon,
  ProjectId,
  ScopedProjectRef,
} from "@aqqua/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentProject } from "./models.ts";
import { scopeProject } from "./models.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { arrayElementsEqual, parseProjectKey, projectKey, projectRefsEqual } from "./entities.ts";

const EMPTY_PROJECTS: ReadonlyArray<OrchestrationProjectShell> = Object.freeze([]);
const EMPTY_PROJECT_INDEX: ReadonlyMap<ProjectId, OrchestrationProjectShell> = new Map();
const EMPTY_PROJECT_ICONS: ReadonlyMap<string, ProjectIcon> = new Map();

/**
 * A project's workspace root, which is how icon consumers address it.
 *
 * Rows that render a project icon (sidebar entries, thread rows, chat headers)
 * hold a workspace root rather than a project id, and it is already the key
 * they pass to the favicon asset resource.
 */
export interface ScopedWorkspaceRootRef {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
}

function projectIconsEqual(left: ProjectIcon, right: ProjectIcon): boolean {
  return left.seed === right.seed && left.text === right.text;
}

export function createEnvironmentProjectAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationShellSnapshot | null>;
}) {
  const environmentProjectsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<OrchestrationProjectShell> =>
        get(input.snapshotAtom(environmentId))?.projects ?? EMPTY_PROJECTS,
    ).pipe(Atom.withLabel(`environment-projects:${environmentId}`)),
  );

  const environmentProjectIndexAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyMap<ProjectId, OrchestrationProjectShell> => {
      const projects = get(environmentProjectsAtom(environmentId));
      if (projects.length === 0) {
        return EMPTY_PROJECT_INDEX;
      }
      return new Map(projects.map((project) => [project.id, project] as const));
    }).pipe(Atom.withLabel(`environment-project-index:${environmentId}`)),
  );

  /**
   * Chosen icons for one environment, keyed by workspace root.
   *
   * Rebuilt whenever the environment's projects change, but entry and map
   * identity survive when the icons themselves did not, so the rows reading
   * this do not repaint on unrelated project updates.
   */
  const environmentProjectIconsAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyMap<string, ProjectIcon> = EMPTY_PROJECT_ICONS;
    return Atom.make((get): ReadonlyMap<string, ProjectIcon> => {
      const next = new Map<string, ProjectIcon>();
      for (const project of get(environmentProjectsAtom(environmentId))) {
        const icon = project.icon;
        if (icon === undefined || icon === null) continue;
        const before = previous.get(project.workspaceRoot);
        next.set(
          project.workspaceRoot,
          before !== undefined && projectIconsEqual(before, icon) ? before : icon,
        );
      }
      if (
        next.size === previous.size &&
        Array.from(next).every(([root, icon]) => previous.get(root) === icon)
      ) {
        return previous;
      }
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`environment-project-icons:${environmentId}`));
  });

  const projectIconAtomFamily = Atom.family((environmentId: EnvironmentId) =>
    Atom.family((workspaceRoot: string) =>
      Atom.make(
        (get): ProjectIcon | null =>
          get(environmentProjectIconsAtom(environmentId)).get(workspaceRoot) ?? null,
      ).pipe(Atom.withLabel(`project-icon:${environmentId}:${workspaceRoot}`)),
    ),
  );

  const environmentProjectRefsAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyArray<ScopedProjectRef> = [];
    return Atom.make((get) => {
      const next = get(environmentProjectsAtom(environmentId)).map((project) => ({
        environmentId,
        projectId: project.id,
      }));
      if (projectRefsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`environment-project-refs:${environmentId}`));
  });

  const projectAtomFamily = Atom.family((key: string) => {
    const ref = parseProjectKey(key);
    let previousSource: OrchestrationProjectShell | null = null;
    let previousValue: EnvironmentProject | null = null;
    return Atom.make((get) => {
      const source = get(environmentProjectIndexAtom(ref.environmentId)).get(ref.projectId) ?? null;
      if (source === previousSource) {
        return previousValue;
      }
      previousSource = source;
      previousValue = source === null ? null : scopeProject(ref.environmentId, source);
      return previousValue;
    }).pipe(Atom.withLabel(`environment-project:${key}`));
  });

  let previousProjectRefs: ReadonlyArray<ScopedProjectRef> = [];
  const projectRefsAtom = Atom.make((get) => {
    const refs: ScopedProjectRef[] = [];
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      refs.push(...get(environmentProjectRefsAtom(environmentId)));
    }
    if (projectRefsEqual(previousProjectRefs, refs)) {
      return previousProjectRefs;
    }
    previousProjectRefs = refs;
    return refs;
  }).pipe(Atom.withLabel("environment-project-refs"));

  let previousProjects: ReadonlyArray<EnvironmentProject> = [];
  const projectsAtom = Atom.make((get) => {
    const next = get(projectRefsAtom).flatMap((ref) => {
      const project = get(projectAtomFamily(projectKey(ref)));
      return project === null ? [] : [project];
    });
    if (arrayElementsEqual(previousProjects, next)) {
      return previousProjects;
    }
    previousProjects = next;
    return previousProjects;
  }).pipe(Atom.withLabel("environment-project-list"));

  return {
    environmentProjectsAtom,
    environmentProjectIndexAtom,
    environmentProjectRefsAtom,
    projectRefsAtom,
    projectsAtom,
    projectAtom: (ref: ScopedProjectRef) => projectAtomFamily(projectKey(ref)),
    projectIconAtom: (ref: ScopedWorkspaceRootRef) =>
      projectIconAtomFamily(ref.environmentId)(ref.workspaceRoot),
  };
}
