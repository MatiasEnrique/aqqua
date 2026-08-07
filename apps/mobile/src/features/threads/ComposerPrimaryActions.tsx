import { memo } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { ComposerToolbarButton } from "../../components/ComposerToolbarTrigger";
import { ControlPill } from "../../components/ControlPill";

/**
 * Collapsed pill trailing actions: send, plus stop while a turn runs. Queueing
 * is expanded-only — the pill has no room for a third control.
 */
export const ComposerCollapsedActions = memo(function ComposerCollapsedActions(props: {
  readonly showStop: boolean;
  readonly sendDisabled: boolean;
  readonly onSend: () => void;
  readonly onStop: () => void;
}) {
  const send = (
    <ControlPill
      icon="arrow.up"
      variant="primary"
      disabled={props.sendDisabled}
      onPress={props.onSend}
    />
  );

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(100)}>
      {props.showStop ? (
        <View className="flex-row gap-1">
          {send}
          <ControlPill icon="stop.fill" variant="danger" onPress={props.onStop} />
        </View>
      ) : (
        send
      )}
    </Animated.View>
  );
});

/** Expanded toolbar trailing actions: queue (while running) then send/steer. */
export const ComposerToolbarActions = memo(function ComposerToolbarActions(props: {
  readonly showQueue: boolean;
  readonly queueDisabled: boolean;
  readonly sendDisabled: boolean;
  readonly sendLabel: string;
  readonly onQueue: () => void;
  readonly onSend: () => void;
}) {
  return (
    <>
      {props.showQueue ? (
        <ComposerToolbarButton
          accessibilityLabel="Queue message"
          icon="text.badge.plus"
          disabled={props.queueDisabled}
          onPress={props.onQueue}
          showChevron={false}
        />
      ) : null}
      <ComposerToolbarButton
        accessibilityLabel={props.sendLabel}
        icon="arrow.up"
        variant="primary"
        disabled={props.sendDisabled}
        onPress={props.onSend}
        showChevron={false}
      />
    </>
  );
});
