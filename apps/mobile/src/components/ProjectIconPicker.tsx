import type { ProjectIcon } from "@aqqua/contracts";
import {
  PROJECT_AVATAR_VARIANT_COUNT,
  projectAvatarInitials,
  projectAvatarSeedVariants,
  truncateProjectAvatarText,
} from "@aqqua/shared/projectAvatar";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "./AppText";
import { ProjectAvatar } from "./ProjectAvatar";
import { cn } from "../lib/cn";
import { useThemeColor } from "../lib/useThemeColor";

function buildIcon(seed: string, text: string): ProjectIcon {
  return { _tag: "avatar", seed, ...(text.length > 0 ? { text } : {}) };
}

/** Native project avatar picker used by creation and mobile settings. */
export function ProjectIconPicker(props: {
  readonly title: string;
  readonly workspaceRoot: string;
  readonly value: ProjectIcon | null;
  readonly onChange: (icon: ProjectIcon | null) => void;
  readonly disabled?: boolean | undefined;
}) {
  const ringColor = useThemeColor("--color-primary");
  const borderColor = useThemeColor("--color-border");
  const seeds = useMemo(
    () => projectAvatarSeedVariants(props.workspaceRoot, PROJECT_AVATAR_VARIANT_COUNT),
    [props.workspaceRoot],
  );
  const defaultText = useMemo(() => projectAvatarInitials(props.title), [props.title]);
  const committedText = props.value === null ? defaultText : (props.value.text ?? "");
  const [draftText, setDraftText] = useState<string | null>(null);
  const text = draftText ?? committedText;

  const commitText = () => {
    setDraftText(null);
    if (props.value === null || draftText === null) return;
    const next = draftText.trim();
    if (next === committedText) return;
    props.onChange(buildIcon(props.value.seed, next));
  };

  return (
    <View className={cn("gap-4", props.disabled && "opacity-60")}>
      <View
        className="flex-row flex-wrap gap-3"
        accessibilityLabel="Project avatar"
        accessibilityRole="radiogroup"
      >
        {seeds.map((seed, index) => {
          const selected = props.value !== null && props.value.seed === seed;
          return (
            <Pressable
              key={seed}
              accessibilityLabel={`Avatar option ${index + 1}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: props.disabled }}
              disabled={props.disabled}
              onPress={() => {
                setDraftText(null);
                props.onChange(buildIcon(seed, text.trim()));
              }}
              className="rounded-[12px] p-1 active:opacity-65"
              style={{
                borderColor: selected ? ringColor : borderColor,
                borderWidth: selected ? 2 : 1,
              }}
            >
              <ProjectAvatar
                icon={buildIcon(seed, text.trim())}
                projectTitle={`Avatar option ${index + 1}`}
                size={40}
              />
            </Pressable>
          );
        })}
      </View>

      <View className="gap-2">
        <Text className="text-sm font-aqqua-medium text-foreground-muted">Initials</Text>
        <TextInput
          accessibilityLabel="Initials"
          value={text}
          editable={props.value !== null && !props.disabled}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={defaultText}
          returnKeyType="done"
          className={cn(
            "h-12 min-h-12 rounded-[20px] px-4 py-0 text-base",
            props.value === null && "opacity-45",
          )}
          onChangeText={(value) => setDraftText(truncateProjectAvatarText(value))}
          onBlur={commitText}
          onSubmitEditing={commitText}
        />
      </View>

      {props.value === null ? (
        <Text className="text-sm text-foreground-muted">
          Using the project favicon or folder fallback.
        </Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: props.disabled }}
          disabled={props.disabled}
          className="self-start rounded-full bg-subtle px-4 py-3 active:opacity-65"
          onPress={() => {
            setDraftText(null);
            props.onChange(null);
          }}
        >
          <Text className="text-sm font-aqqua-bold text-foreground">Use project favicon</Text>
        </Pressable>
      )}
    </View>
  );
}
