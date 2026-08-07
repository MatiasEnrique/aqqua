import { memo } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { AppText as Text } from "../../components/AppText";
import type { ThreadQueuedMessagePresentation } from "../../state/use-thread-composer-state";
import { queuedMessagePreview } from "./composerQueuePresentation";

export const ComposerMessageQueue = memo(function ComposerMessageQueue(props: {
  readonly messages: ReadonlyArray<ThreadQueuedMessagePresentation>;
  readonly onDequeue: (messageId: ThreadQueuedMessagePresentation["messageId"]) => void;
}) {
  if (props.messages.length === 0) {
    return null;
  }

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
      <Text className="pt-2 text-xs font-aqqua-bold text-foreground-muted">
        Queued · {props.messages.length}
      </Text>
      <View className="gap-1 pt-1">
        {props.messages.map((message) => {
          const preview = queuedMessagePreview(message);
          return (
            <View
              key={message.messageId}
              className="flex-row items-center gap-2 rounded-lg bg-subtle px-2 py-1.5"
            >
              <Text className="min-w-0 flex-1 text-xs text-foreground" numberOfLines={1}>
                {preview}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove queued message: ${preview}`}
                onPress={() => props.onDequeue(message.messageId)}
                className="size-6 items-center justify-center rounded-full active:bg-subtle-strong"
              >
                <Text className="text-base leading-none text-foreground-muted">×</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
});
