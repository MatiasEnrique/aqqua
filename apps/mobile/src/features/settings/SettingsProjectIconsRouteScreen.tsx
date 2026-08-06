import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { EnvironmentProject } from "@aqqua/client-runtime/state/shell";
import { EnvironmentId, ProjectId, type ProjectIcon } from "@aqqua/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  type ListRenderItemInfo,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { ProjectIconPicker } from "../../components/ProjectIconPicker";
import { SymbolView } from "../../components/AppSymbol";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useProject, useProjectIcon, useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import {
  useSavedRemoteConnection,
  useSavedRemoteConnections,
} from "../../state/use-remote-environment-registry";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThemeColor } from "../../lib/useThemeColor";

function iconsEqual(left: ProjectIcon | null, right: ProjectIcon | null): boolean {
  return left?.seed === right?.seed && left?.text === right?.text;
}

function AndroidProjectIconsHeader(props: { readonly title: string }) {
  const navigation = useNavigation();
  if (Platform.OS !== "android") return null;
  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <AndroidScreenHeader title={props.title} onBack={() => navigation.goBack()} />
    </>
  );
}

export function SettingsProjectIconsRouteScreen() {
  const navigation = useNavigation();
  const projects = useProjects();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const insets = useSafeAreaInsets();
  const chevronColor = useThemeColor("--color-chevron");
  const renderProject = useCallback(
    ({ item: project, index }: ListRenderItemInfo<EnvironmentProject>) => {
      const environmentLabel =
        savedConnectionsById[project.environmentId]?.environmentLabel ?? project.environmentId;
      const rowClassName =
        projects.length === 1
          ? "rounded-[24px] bg-card p-4 active:opacity-65"
          : index === 0
            ? "rounded-t-[24px] bg-card p-4 active:opacity-65"
            : index === projects.length - 1
              ? "rounded-b-[24px] border-t border-border bg-card p-4 active:opacity-65"
              : "border-t border-border bg-card p-4 active:opacity-65";

      return (
        <Pressable
          accessibilityLabel={`Edit ${project.title} icon in ${environmentLabel}`}
          accessibilityRole="button"
          className={rowClassName}
          onPress={() =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsProjectIcon",
              params: {
                environmentId: project.environmentId,
                projectId: project.id,
              },
            })
          }
        >
          <View className="flex-row items-center gap-3">
            <ProjectFavicon
              environmentId={project.environmentId}
              projectTitle={project.title}
              workspaceRoot={project.workspaceRoot}
              size={36}
            />
            <View className="min-w-0 flex-1">
              <Text className="text-base font-aqqua-bold" numberOfLines={1}>
                {project.title}
              </Text>
              <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                {environmentLabel} · {project.workspaceRoot}
              </Text>
            </View>
            <SymbolView name="chevron.right" size={16} tintColor={chevronColor} type="monochrome" />
          </View>
        </Pressable>
      );
    },
    [chevronColor, navigation, projects.length, savedConnectionsById],
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <AndroidProjectIconsHeader title="Project Icons" />
      <FlatList
        data={projects}
        keyExtractor={(project) => `${project.environmentId}:${project.id}`}
        renderItem={renderProject}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        ListHeaderComponent={
          <Text className="px-2 pb-3 text-sm text-foreground-muted">
            Choose a local avatar or return any project to automatic favicon discovery.
          </Text>
        }
        ListEmptyComponent={
          <View className="rounded-[24px] bg-card">
            <Text className="px-5 py-7 text-center text-foreground-muted">
              No projects are available.
            </Text>
          </View>
        }
      />
    </View>
  );
}

type ProjectIconRouteParams = {
  readonly environmentId: string;
  readonly projectId: string;
};

export function SettingsProjectIconRouteScreen({
  route,
}: StaticScreenProps<ProjectIconRouteParams>) {
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const projectId = ProjectId.make(route.params.projectId);
  const projectRef = useMemo(() => ({ environmentId, projectId }), [environmentId, projectId]);
  const project = useProject(projectRef);
  const connection = useSavedRemoteConnection(environmentId);
  const storedIcon = useProjectIcon(environmentId, project?.workspaceRoot);
  const [pendingIcon, setPendingIcon] = useState<ProjectIcon | null | undefined>(undefined);
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const icon = pendingIcon === undefined ? storedIcon : pendingIcon;

  useEffect(() => {
    if (pendingIcon !== undefined && iconsEqual(pendingIcon, storedIcon)) {
      setPendingIcon(undefined);
    }
  }, [pendingIcon, storedIcon]);

  const changeIcon = async (nextIcon: ProjectIcon | null) => {
    if (project === null) return;
    setPendingIcon(nextIcon);
    const result = await updateProject({
      environmentId: project.environmentId,
      input: { projectId: project.id, icon: nextIcon },
    });
    if (AsyncResult.isFailure(result)) {
      setPendingIcon(undefined);
      const error = Cause.squash(result.cause);
      Alert.alert(
        "Could not update project icon",
        error instanceof Error ? error.message : "An error occurred.",
      );
    }
  };

  const title = project?.title ?? "Project Icon";
  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ title }} />
      <AndroidProjectIconsHeader title={title} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {project === null ? (
          <Text className="rounded-[24px] bg-card p-5 text-center text-foreground-muted">
            This project is no longer available.
          </Text>
        ) : (
          <View className="gap-4 rounded-[24px] bg-card p-4">
            <View>
              <Text className="text-base font-aqqua-bold">{project.title}</Text>
              {connection !== null ? (
                <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                  {connection.environmentLabel}
                </Text>
              ) : null}
              <Text className="text-xs text-foreground-muted" numberOfLines={2}>
                {project.workspaceRoot}
              </Text>
            </View>
            <ProjectIconPicker
              title={project.title}
              workspaceRoot={project.workspaceRoot}
              value={icon}
              onChange={(nextIcon) => void changeIcon(nextIcon)}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
