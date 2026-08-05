import { useNavigation } from "@react-navigation/native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentQuery } from "../../state/query";
import { providerSessionsEnvironment } from "../../state/providerSessions";
import { relativeTime } from "../../lib/time";
import { useNewTaskFlow } from "./new-task-flow-provider";

export function NewTaskResumePickerScreen() {
  const navigation = useNavigation();
  const flow = useNewTaskFlow();
  const [query, setQuery] = useState("");
  const projectRoot = flow.selectedProject?.workspaceRoot ?? null;
  const cwds = useMemo(
    () =>
      projectRoot
        ? Array.from(
            new Set([
              projectRoot,
              ...flow.managedWorktrees.flatMap((worktree) =>
                worktree.worktreePath && worktree.worktreePath !== projectRoot
                  ? [worktree.worktreePath]
                  : [],
              ),
            ]),
          )
        : [],
    [flow.managedWorktrees, projectRoot],
  );
  const sessionsQuery = useEnvironmentQuery(
    flow.selectedProject && flow.selectedModel && cwds.length > 0
      ? providerSessionsEnvironment.listSessions({
          environmentId: flow.selectedProject.environmentId,
          input: {
            instanceId: flow.selectedModel.instanceId,
            cwds,
          },
        })
      : null,
  );
  const sessions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const available = sessionsQuery.data?.sessions ?? [];
    if (!normalized) return available;
    return available.filter((session) =>
      [session.title, session.cwd, session.gitBranch, session.sessionId]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(normalized)),
    );
  }, [query, sessionsQuery.data?.sessions]);
  const providerLabel = flow.selectedModelOption?.subtitle ?? "Selected provider";

  let emptyCopy = "No CLI conversations found in this project.";
  if (sessionsQuery.error) emptyCopy = sessionsQuery.error;
  else if (sessionsQuery.data?.supported === false)
    emptyCopy = "Resuming conversations is not supported by this provider.";
  else if (sessionsQuery.isPending) emptyCopy = "Searching CLI conversations…";
  else if (query.trim()) emptyCopy = "No matching conversations.";

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions options={{ title: "Earlier conversation" }} />
      <View className="border-b border-border px-4 py-3">
        <TextInput
          accessibilityLabel="Search earlier conversations"
          autoFocus
          className="rounded-xl bg-subtle px-4 py-3 text-base text-foreground"
          onChangeText={setQuery}
          placeholder="Search earlier conversations"
          value={query}
        />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="mb-2 text-xs font-aqqua-bold tracking-wide text-foreground-muted uppercase">
          {providerLabel}
        </Text>
        {sessions.length > 0 ? (
          <View className="overflow-hidden rounded-2xl bg-card">
            {sessions.map((session, index) => (
              <Pressable
                key={session.sessionId}
                accessibilityLabel={`Resume ${session.title}`}
                className={`px-4 py-3 active:opacity-65 ${index > 0 ? "border-t border-border-subtle" : ""}`}
                onPress={() => {
                  if (!flow.setResumeSession(session)) {
                    Alert.alert(
                      "Conversation unavailable",
                      "This conversation is no longer rooted in the project or one of its managed worktrees.",
                    );
                    return;
                  }
                  navigation.goBack();
                }}
              >
                <Text className="text-base font-aqqua-bold text-foreground" numberOfLines={2}>
                  {session.title}
                </Text>
                <Text className="mt-1 text-sm text-foreground-muted" numberOfLines={1}>
                  {session.messageCount > 0 ? `${session.messageCount} messages · ` : ""}
                  {relativeTime(session.updatedAt)}
                  {session.gitBranch ? ` · ${session.gitBranch}` : ""}
                </Text>
                {projectRoot !== session.cwd ? (
                  <Text className="mt-1.5 text-xs text-foreground-muted" numberOfLines={1}>
                    {session.cwd}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : (
          <View className="items-center px-5 py-12">
            {sessionsQuery.isPending ? <ActivityIndicator className="mb-3" /> : null}
            <Text className="text-center text-sm text-foreground-muted">{emptyCopy}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
