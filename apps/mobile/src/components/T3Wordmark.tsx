import { Image } from "expo-image";
import type { ColorValue } from "react-native";

/**
 * The 3T Code brand mark used in compact mobile chrome.
 */
export function T3Wordmark(props: { readonly height: number; readonly color: ColorValue }) {
  return (
    <Image
      source={require("../../../../assets/3t-code-nobg.png")}
      accessibilityLabel="3T Code"
      accessibilityIgnoresInvertColors
      contentFit="contain"
      style={{ width: props.height, height: props.height }}
    />
  );
}
