import type { DesktopPreviewAnnotationTheme } from "@aqqua/contracts";

const readVariable = (styles: CSSStyleDeclaration, name: string, fallback: string): string =>
  styles.getPropertyValue(name).trim() || fallback;

export function readPreviewAnnotationTheme(): DesktopPreviewAnnotationTheme {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  return {
    colorScheme: root.classList.contains("dark") ? "dark" : "light",
    radius: readVariable(styles, "--radius", "0.625rem"),
    background: readVariable(styles, "--background", "oklch(0.988 0.006 85)"),
    foreground: readVariable(styles, "--foreground", "oklch(0.28 0.002 72)"),
    popover: readVariable(styles, "--popover", "oklch(0.997 0.003 85)"),
    popoverForeground: readVariable(styles, "--popover-foreground", "oklch(0.28 0.002 72)"),
    primary: readVariable(styles, "--primary", "oklch(0.35 0.038 258)"),
    primaryForeground: readVariable(styles, "--primary-foreground", "white"),
    muted: readVariable(styles, "--muted", "oklch(0.97 0.006 85)"),
    mutedForeground: readVariable(styles, "--muted-foreground", "oklch(0.508 0.004 78)"),
    accent: readVariable(styles, "--accent", "oklch(0.93 0.006 84)"),
    accentForeground: readVariable(styles, "--accent-foreground", "oklch(0.22 0.002 70)"),
    border: readVariable(styles, "--border", "oklch(0.87 0.006 83)"),
    input: readVariable(styles, "--input", "oklch(0.775 0.005 82)"),
    ring: readVariable(styles, "--ring", "oklch(0.35 0.038 258)"),
    fontSans: readVariable(styles, "--font-sans", styles.fontFamily || "system-ui, sans-serif"),
    fontMono: readVariable(styles, "--font-mono", "ui-monospace, monospace"),
  };
}
