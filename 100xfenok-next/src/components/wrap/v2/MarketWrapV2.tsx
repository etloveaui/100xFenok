"use client";

import { useCallback, useRef, useState } from "react";
import Navbar from "./Navbar";
import Hero from "./Hero";
import Prose from "./Prose";
import AnchorRail from "./AnchorRail";
import SectionStack from "./SectionStack";
import Archive from "./Archive";
import FooterTicker from "./FooterTicker";
import { WRAP_DATA } from "./mockData";

/**
 * Market Wrap V2 — Narrative Long-Read composer.
 * Mock data for now; live `/100x/daily-wrap` hook wiring is BACKLOG #289.
 */
export default function MarketWrapV2() {
  const wrap = WRAP_DATA;
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["01"]));
  const [activeAnchor, setActiveAnchor] = useState<number | null>(null);
  const railRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const registerRef = useCallback((id: number, node: HTMLDivElement | null) => {
    railRefs.current[id] = node;
  }, []);

  const handleAnchorClick = useCallback((id: number) => {
    const node = railRefs.current[id];
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setActiveAnchor(id);
    window.setTimeout(() => {
      setActiveAnchor((current) => (current === id ? null : current));
    }, 1200);
  }, []);

  const handleSectionToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="mw-root">
      <Navbar />
      <Hero wrap={wrap} />
      <section className="mw-body">
        <div className="mw-body-inner">
          <Prose chapters={wrap.chapters} onAnchorClick={handleAnchorClick} />
          <AnchorRail
            anchors={wrap.anchors}
            activeId={activeAnchor}
            registerRef={registerRef}
          />
        </div>
      </section>
      <SectionStack
        sections={wrap.sections}
        expanded={expanded}
        onToggle={handleSectionToggle}
      />
      <Archive />
      <FooterTicker anchors={wrap.anchors} marketState="OPEN" />
    </div>
  );
}
