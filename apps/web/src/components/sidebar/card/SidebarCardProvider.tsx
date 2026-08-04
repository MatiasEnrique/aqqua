import { cn } from "~/lib/utils";
import type { ProviderInstanceEntry } from "../../../providerInstances";
import { ProviderInstanceIcon } from "../../chat/ProviderInstanceIcon";

/**
 * Who is driving this row: the provider's mark, with the instance and model in
 * the accessible name. Renders nothing when the driver is unknown (a shell
 * whose provider instance is no longer configured) rather than a placeholder —
 * an empty slot says less than a wrong one.
 */
export function SidebarCardProvider(props: {
  readonly driverKind: ProviderInstanceEntry["driverKind"] | null;
  readonly displayName: string;
  readonly modelLabel: string;
  /** Cards give the mark its own 4-unit box; nested rows let it sit inline. */
  readonly size?: "sm" | "md";
  readonly className?: string;
}) {
  if (props.driverKind === null) return null;
  const label = `${props.displayName}, ${props.modelLabel}`;
  const isMedium = props.size === "md";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center opacity-60",
        isMedium && "size-4 justify-center self-center leading-none",
        props.className,
      )}
    >
      <ProviderInstanceIcon
        driverKind={props.driverKind}
        displayName={props.displayName}
        iconClassName={isMedium ? "size-3.5" : "size-3"}
      />
    </span>
  );
}
