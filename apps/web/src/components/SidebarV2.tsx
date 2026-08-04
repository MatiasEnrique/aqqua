import { SidebarV2View } from "./sidebar-v2/SidebarV2View";
import { useSidebarV2Model } from "./sidebar-v2/useSidebarV2Model";

/**
 * The regular sidebar: one flat list of conversations ordered by recency.
 *
 * Shares its read model, lifecycle controllers and row chrome with the
 * worktree view — grouping is the only difference, and this entry pins it to
 * `flat` so the regular sidebar can never be reshaped by the worktree view's
 * own grouping preference.
 */
export default function SidebarV2() {
  const model = useSidebarV2Model({ groupingMode: "flat" });
  return <SidebarV2View model={model} />;
}
