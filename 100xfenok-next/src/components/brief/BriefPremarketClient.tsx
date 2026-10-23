"use client";

import "@/styles/brief.css";
import { useEffect, useRef, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";
import {
  BRIEF_DATE_RE,
  BRIEF_PREMARKET_PACK_URL,
  BRIEF_INDEX_URL,
  briefPremarketDataUrl,
  dateline,
  monthDay,
  sortedEditions,
  type BriefDigest,
  type BriefIndex,
} from "@/lib/brief/brief";
import { ROUTES } from "@/lib/routes";

const MARKER = /<script type="application\/json" id="feno-pack-content">[\s\S]*?<\/script>/;
const TOKEN = /\{\{feno:([a-z_]+)\}\}/g;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON that cannot close its <script> block (the pack binder's escaping). */
const safeJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

/**
 * One edition bound into the selected product pack as feno_canvas_pack.py binds it (tokens, then the content
 * block), with the pack's own top bar hidden because the site's top bar already names the product.
 */
export function bindPremarketPack(pack: string, doc: BriefDigest): string {
  const tokens: Record<string, string> = {
    headline: doc.headline,
    date: doc.date,
    market_date: doc.market_date,
    product: doc.product_name ?? "프리마켓 브리프",
  };
  const withTokens = pack.replace(TOKEN, (_m, key: string) => escapeHtml(tokens[key] ?? ""));
  const block = `<script type="application/json" id="feno-pack-content">${safeJson(doc)}</script>`;
  return withTokens.replace(MARKER, () => block).replace(/<html([^>]*)>/, '<html$1 class="embed">');
}

function isPremarket(doc: unknown, date: string): doc is BriefDigest {
  const d = doc as Partial<BriefDigest> | null;
  return !!d && d.schema === "daily-digest/v1" && d.date === date && d.product_name === "프리마켓 브리프" && typeof d.headline === "string";
}

export default function BriefPremarketClient({ date }: { date: string }) {
  const validDate = BRIEF_DATE_RE.test(date);
  const [page, setPage] = useState<string | null | undefined>(validDate ? undefined : null);
  const [index, setIndex] = useState<BriefIndex | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!validDate) return;
    let cancelled = false;
    Promise.all([
      fetchJsonOrNull<unknown>(briefPremarketDataUrl(date)),
      fetch(BRIEF_PREMARKET_PACK_URL).then((r) => (r.ok ? r.text() : null)).catch(() => null),
    ]).then(([doc, pack]) => {
      if (cancelled) return;
      setPage(pack && isPremarket(doc, date) ? bindPremarketPack(pack, doc) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [date, validDate]);

  useEffect(() => {
    if (page !== null) return;
    let cancelled = false;
    fetchJsonOrNull<BriefIndex>(BRIEF_INDEX_URL).then((doc) => {
      if (!cancelled) setIndex(doc);
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  // The pack scrolls inside its frame (its scroll-driven figures need their own viewport), so the
  // frame fills the space under the site's top bars and above the phone tab bar.
  useEffect(() => {
    if (!page) return;
    const fit = () => {
      const f = frame.current;
      if (!f) return;
      const top = f.getBoundingClientRect().top + window.scrollY;
      const tab = document.querySelector<HTMLElement>(".tabbar");
      const below = tab && getComputedStyle(tab).display !== "none" ? tab.offsetHeight : 0;
      f.style.height = `${Math.max(420, window.innerHeight - top - below)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [page]);

  if (page === undefined) {
    return (
      <div className="fnk-brief" data-premarket={date} data-brief-state="loading">
        <div className="wrap">
          <article aria-busy="true">
            <p className="sr-only" role="status">프리마켓 브리프를 불러오는 중입니다.</p>
            <span className="skel" style={{ width: "40%", height: 14, marginTop: 6 }} />
            <span className="skel" style={{ width: "90%", height: 34, marginTop: 18 }} />
            <span className="skel" style={{ width: "100%", height: 300, marginTop: 22, borderRadius: 14 }} />
          </article>
        </div>
      </div>
    );
  }

  if (page === null) {
    const latest = sortedEditions(index, "premarket").slice(-1)[0];
    return (
      <div className="fnk-brief" data-premarket={date} data-brief-state="not-found">
        <div className="wrap">
          <article>
            <div className="prov crumb">
              <TransitionLink href={ROUTES.brief}>브리핑</TransitionLink>
              <span>› 프리마켓 브리프</span>
            </div>
            <div className="state" role="status">
              <b>이 날짜의 프리마켓 브리프가 없습니다</b>
              {validDate ? `${dateline(date)}에는 발행된 프리마켓 브리프가 없습니다.` : "날짜 형식이 올바르지 않습니다."}
              <br />
              {latest ? (
                <TransitionLink href={ROUTES.briefPremarket(latest.edition_date)}>
                  최신 프리마켓 브리프 읽기 ({monthDay(latest.edition_date)}) →
                </TransitionLink>
              ) : (
                <TransitionLink href={ROUTES.brief}>브리핑 홈으로 →</TransitionLink>
              )}
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div data-premarket={date} data-brief-state="ready">
      <iframe
        ref={frame}
        title="100x 프리마켓 브리프"
        srcDoc={page}
        // Scripts only, in an opaque origin: the pack needs no storage, cookies or access to the site page.
        sandbox="allow-scripts"
        style={{ display: "block", width: "100%", height: "calc(100vh - 140px)", border: 0, background: "#fff" }}
      />
    </div>
  );
}
