import { SidebarV2View } from "./sidebar-v2/SidebarV2View";
import { useSidebarV2Model } from "./sidebar-v2/useSidebarV2Model";

/** The conversation sidebar: worktree cards with conversation tabs. */
export default function ConversationSidebar() {
  const model = useSidebarV2Model();
  return <SidebarV2View model={model} />;
}
