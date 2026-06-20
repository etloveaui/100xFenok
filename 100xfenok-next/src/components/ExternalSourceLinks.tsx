"use client";

type ExternalSourceKind = "stock" | "etf" | "filing";

interface ExternalSourceLinksProps {
  ticker?: string | null;
  kind: ExternalSourceKind;
  secUrl?: string | null;
  statusLine?: string | null;
  asOf?: string | null;
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

const KIND_COPY: Record<Exclude<ExternalSourceKind, "filing">, string> = {
  stock: "종목 데이터가 비어 있거나 보강 중이면 외부 자료로 시세와 재무를 교차 확인할 수 있습니다.",
  etf: "ETF 보유 구성이나 상세 지표가 아직 덜 연결된 경우 외부 자료로 구성과 비용을 보강 확인할 수 있습니다.",
};

function sourceDescription(kind: ExternalSourceKind, hasSecUrl: boolean) {
  if (kind !== "filing") return KIND_COPY[kind];
  if (hasSecUrl) return "한글 요약이 아직 없는 공시는 SEC 원문을 먼저 확인할 수 있습니다.";
  return "한글 요약이나 원문 링크가 아직 연결되지 않은 경우 외부 자료로 종목 정보를 교차 확인할 수 있습니다.";
}

function cleanMeta(value?: string | null) {
  const text = value?.trim();
  return text && text !== "—" ? text : null;
}

export default function ExternalSourceLinks({
  ticker,
  kind,
  secUrl,
  statusLine,
  asOf,
  className = "",
  compact = false,
}: ExternalSourceLinksProps) {
  const symbol = cleanTicker(ticker);
  const status = cleanMeta(statusLine);
  const date = cleanMeta(asOf);
  const links: Array<{ label: string; href: string; hint: string }> = [];
  const hasSecUrl = Boolean(kind === "filing" && secUrl);

  if (hasSecUrl && secUrl) {
    links.push({ label: "SEC 원문", href: secUrl, hint: "원공시" });
  }
  if (symbol) {
    links.push({
      label: "Yahoo Finance",
      href: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
      hint: "시세·차트",
    });
    links.push({
      label: "StockAnalysis",
      href: stockAnalysisUrl(kind, symbol),
      hint: kind === "etf" ? "보유·비용" : "재무·밸류",
    });
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
            {sourceDescription(kind, hasSecUrl)} 아래 링크는 100xFenok 내부 데이터가 아닌 외부 사이트로 이동합니다.
          </p>
          {status || date ? (
            <p className="mt-1 text-[10px] font-black leading-relaxed text-slate-500">
              {[status, date ? `기준 ${date}` : null].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
          {links.map((link) => (
            <a
              key={`${link.label}-${link.href}`}
              href={link.href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-10 flex-col items-start justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black leading-tight text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              <span>{link.label}</span>
              <span className="mt-0.5 font-semibold text-slate-600">{link.hint}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
