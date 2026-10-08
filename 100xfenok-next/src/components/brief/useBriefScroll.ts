"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

const NONE: ReadonlySet<string> = new Set();

/**
 * The mockup's scroll behaviour for an article: a reading-progress bar written
 * straight to the DOM (no re-render per frame), the table-of-contents entry
 * whose section top has passed 150px, and sections revealed once they scroll
 * into view. `idsKey` is the section ids joined by "|"; `resetKey` restarts the
 * reveal when a different edition renders into the same component.
 */
export function useBriefScroll(rootRef: RefObject<HTMLElement | null>, idsKey: string, resetKey: string) {
  const progressRef = useRef<HTMLElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [revealed, setRevealed] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: resetKey, ids: NONE });

  useEffect(() => {
    const ids = idsKey.split("|");
    let ticking = false;
    let frame = 0;
    const update = () => {
      ticking = false;
      const doc = document.documentElement;
      const ratio = doc.scrollTop / (doc.scrollHeight - doc.clientHeight || 1);
      if (progressRef.current) progressRef.current.style.width = `${(Math.min(1, Math.max(0, ratio)) * 100).toFixed(1)}%`;
      let current = -1;
      ids.forEach((id, i) => {
        const node = document.getElementById(id);
        if (node && node.getBoundingClientRect().top < 150) current = i;
      });
      setActiveIndex((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [idsKey, resetKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("section.s"));
    const reveal = (id: string) =>
      setRevealed((prev) => {
        if (prev.key === resetKey && prev.ids.has(id)) return prev;
        const next = new Set(prev.key === resetKey ? prev.ids : NONE);
        next.add(id);
        return { key: resetKey, ids: next };
      });
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => targets.forEach((target) => reveal(target.id)));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target.id);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [rootRef, idsKey, resetKey]);

  return { progressRef, activeIndex, revealed: revealed.key === resetKey ? revealed.ids : NONE };
}
