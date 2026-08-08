/**
 * Scroll reveals for engines without scroll-driven animations.
 *
 * Chrome runs `.reveal` off `animation-timeline: view()` straight from CSS, so
 * this only wires anything up where that is missing (Safari, Firefox). Elements
 * stay revealed once seen — re-hiding on scroll-up reads as a glitch, not a
 * flourish.
 */
export function initReveals(): void {
  if (CSS.supports("animation-timeline", "view()")) return;

  const targets = document.querySelectorAll<HTMLElement>(".reveal");
  if (targets.length === 0) return;

  if (!("IntersectionObserver" in window)) {
    for (const target of targets) target.classList.add("is-visible");
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
  );

  for (const target of targets) observer.observe(target);
}

/**
 * Word-by-word tagline reveal.
 *
 * Each word inside a `[data-tagline]` block flips from its muted tone to full
 * colour as the block scrolls through a trigger line at 70% of the viewport,
 * in reading order. One scroll listener, throttled through rAF — never per
 * frame work outside it. Words stay lit once seen, matching `.reveal` above.
 */
export function initTaglineReveal(): void {
  const blocks = document.querySelectorAll<HTMLElement>("[data-tagline]");
  if (blocks.length === 0) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const entries = Array.from(blocks, (block) => ({
    block,
    words: Array.from(block.querySelectorAll<HTMLElement>(".tagline-word")),
    lit: 0,
  }));

  if (reduceMotion) {
    for (const entry of entries) {
      for (const word of entry.words) word.classList.add("is-on");
    }
    return;
  }

  let ticking = false;

  const update = () => {
    ticking = false;
    const trigger = window.innerHeight * 0.7;

    for (const entry of entries) {
      if (entry.lit >= entry.words.length) continue;

      const rect = entry.block.getBoundingClientRect();
      const progress = (trigger - rect.top) / Math.max(rect.height, 1);
      const target = Math.max(
        entry.lit,
        Math.min(entry.words.length, Math.ceil(progress * entry.words.length)),
      );

      while (entry.lit < target) {
        entry.words[entry.lit].classList.add("is-on");
        entry.lit += 1;
      }
    }

    if (entries.every((entry) => entry.lit >= entry.words.length)) {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    }
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  onScroll();
}

/** Flips the nav to its solid state once the page has left the hero. */
export function initNavScroll(): void {
  const page = document.querySelector<HTMLElement>(".page");
  if (!page) return;

  const sentinel = document.createElement("div");
  sentinel.className = "nav-sentinel";
  sentinel.setAttribute("aria-hidden", "true");
  page.prepend(sentinel);

  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    ([entry]) => {
      page.classList.toggle("is-scrolled", !entry.isIntersecting);
    },
    { threshold: 0 },
  );

  observer.observe(sentinel);
}
