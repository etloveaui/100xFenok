"use client";

type ExternalSourceKind = "stock" | "etf" | "filing";

interface ExternalSourceLinksProps {
  ticker?: string | null;
  kind: ExternalSourceKind;
  secUrl?: string | null;
  className?: string;
  compact?: boolean;
}

function cleanTicker(ticker?: string | null) {
  const value = (ticker ?? "").replace(/^\$/, "").trim().toUpperCase();
  return value || null;
}

function stockAnalysisUrl(kind: ExternalSourceKind, symbol: string) {
  const pathKind = kind === "etf" ? "etf" : "stocks";
  return `https://stockanalysis.com/${pathKind}/${encodeURIComponent(symbol.toLowerCase())}/`;
}

export default function ExternalSourceLinks({
  ticker,
  kind,
  secUrl,
  className = "",
  compact = false,
}: ExternalSourceLinksProps) {
  const symbol = cleanTicker(ticker);
  const links: Array<{ label: string; href: string }> = [];

  if (kind === "filing" && secUrl) {
    links.push({ label: "SEC 원문", href: secUrl });
  }
  if (symbol) {
    links.push({ label: "Yahoo Finance", href: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}` });
    links.push({ label: "StockAnalysis", href: stockAnalysisUrl(kind, symbol) });
  }

  if (links.length === 0) return null;

  return (
    <div
      data-external-source-links
      className={`rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left ${className}`}
    >
      <div className={compact ? "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" : ""}>
        <div>
          <p className="text-[11px] font-black text-slate-800">외부에서 보기</p>
          <p className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-500">
            일부 100xFenok 데이터가 아직 보강 전입니다. 아래 링크는 100xFenok 내부 데이터가 아닌 외부 사이트로 이동합니다.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
          {links.map((link) => (
            <a
              key={`${link.label}-${link.href}`}
              href={link.href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
