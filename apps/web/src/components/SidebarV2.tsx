import { SidebarV2View } from "./sidebar-v2/SidebarV2View";
import { useSidebarV2Model } from "./sidebar-v2/useSidebarV2Model";

/**
 * Sidebar V2 composition root. Domain sections and controllers live under
 * `sidebar-v2/`; this file only wires the model into the view.
 */
export default function SidebarV2() {
  const model = useSidebarV2Model();
  return <SidebarV2View model={model} />;
}
