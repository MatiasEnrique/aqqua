import { cn } from "~/lib/utils";

export function AqquaWorkingIcon(props: {
  readonly className?: string;
  readonly "aria-hidden"?: boolean;
}) {
  return (
    <AqquaStateIcon {...(props.className === undefined ? {} : { className: props.className })} />
  );
}

export function AqquaBreathingStateIcon(props: {
  readonly className?: string;
  readonly "aria-hidden"?: boolean;
}) {
  return (
    <AqquaStateIcon {...(props.className === undefined ? {} : { className: props.className })} />
  );
}

export function AqquaRestingStateIcon(props: {
  readonly className?: string;
  readonly "aria-hidden"?: boolean;
}) {
  return (
    <AqquaStateIcon
      {...(props.className === undefined ? {} : { className: props.className })}
      breathing={false}
    />
  );
}

const RING_DOTS = [0, 1, 2, 3, 4, 5, 6, 7];

const DOT_SIZE_PERCENT = 20;

const DOT_ORIGIN_Y_PERCENT = (50 / DOT_SIZE_PERCENT) * 100;

export function AqquaStateIcon(props: {
  readonly className?: string;
  readonly breathing?: boolean;
  readonly "aria-hidden"?: boolean;
}) {
  const breathing = props.breathing ?? true;
  return (
    <span className={cn("relative inline-block shrink-0", props.className)}>
      {RING_DOTS.map((index) => (
        <span
          aria-hidden
          key={index}
          className={cn(
            "absolute top-0 left-1/2 rounded-full bg-current",
            breathing ? "animate-aqqua-ring-dot motion-reduce:animate-none" : "opacity-70",
          )}
          style={{
            width: `${DOT_SIZE_PERCENT}%`,
            height: `${DOT_SIZE_PERCENT}%`,
            marginLeft: `${-DOT_SIZE_PERCENT / 2}%`,
            transformOrigin: `50% ${DOT_ORIGIN_Y_PERCENT}%`,
            rotate: `${index * (360 / RING_DOTS.length)}deg`,
            animationDelay: `${index * 150}ms`,
          }}
        />
      ))}
    </span>
  );
}
