/** Drives every captured product demo from one IntersectionObserver. */
const PLAY_RATIO = 0.35;

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function setPlaying(demo: HTMLElement, playing: boolean): void {
  const videos = demo.querySelectorAll<HTMLVideoElement>("video");
  for (const video of videos) {
    // Reduced motion never starts playback: the poster stays as a still frame.
    if (!playing || reducedMotion()) {
      video.pause();
      continue;
    }
    // `preload="none"` means the first play() is also the first byte fetched;
    // play() rejects when the browser blocks autoplay, so swallow it rather
    // than let an unhandled rejection escape.
    void video.play().catch(() => {});
  }
}

export function initDemos(): void {
  const demos = document.querySelectorAll<HTMLElement>("[data-demo]");
  if (demos.length === 0) return;

  // Keep the lightweight posters when visibility cannot be measured. Starting
  // every clip would turn an old-browser fallback into an eager media preload.
  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        setPlaying(
          entry.target as HTMLElement,
          entry.isIntersecting && entry.intersectionRatio >= PLAY_RATIO,
        );
      }
    },
    { threshold: PLAY_RATIO },
  );

  for (const demo of demos) observer.observe(demo);
}
