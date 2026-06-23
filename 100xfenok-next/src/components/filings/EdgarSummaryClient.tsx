"use client";

import { useEffect, useMemo, useState } from "react";
import {
  edgarFilingsForTicker,
  loadEdgarKoreanSummaryCoverage,
  loadEdgarKoreanSummariesForTicker,
  normalizeEdgarTicker,
  type EdgarKoreanSummaryCoverage,
  type EdgarKoreanSummaryFilingEntry,
} from "@/lib/edgarKoreanSummaries";
import ExternalSourceLinks from "@/components/ExternalSourceLinks";

type Stance = "fact" | "management_claim" | "feno_interpretation";

interface FilingSummaryBullet {
  text: string;
  evidence: string[];
  stance: Stance;
}

interface FilingEvidence {
  id: string;
  kind: string;
  section: string;
  anchor: string;
  sourceTextDigest: string;
  sourceUrl: string;
}

interface EdgarKoreanSummaryArtifact {
  schemaVersion: number;
  artifactType: string;
  company: {
    ticker: string;
    cik: string;
    name: string;
  };
  filing: {
    form: string;
    accession: string;
    filingDate: string;
    periodEnd: string;
    primaryDocument: string;
    sourceUrl: string;
  };
  sourceStatus: {
    sectionsRequested: string[];
    sectionsExtracted: string[];
    missingSections: string[];
    xbrlFactsUsed: string[];
    publicationPolicy: string;
  };
  summaryKo: {
    oneLine: string;
    keyPoints: FilingSummaryBullet[];
    riskChanges: FilingSummaryBullet[];
    businessChanges: FilingSummaryBullet[];
    financialHighlights: FilingSummaryBullet[];
    watchItems: FilingSummaryBullet[];
  };
  evidence: FilingEvidence[];
  generation: {
    generatedAtUtc: string;
    promptVersion: string;
    model: string;
    usageMetadata?: {
      totalTokenCount?: number;
    };
    costUsedUsd: number;
    paidQuotaUsed: boolean;
  };
}

const SECTION_LABELS: Array<{
  key: keyof Pick<EdgarKoreanSummaryArtifact["summaryKo"], "keyPoints" | "riskChanges" | "businessChanges" | "financialHighlights" | "watchItems">;
  title: string;
  description: string;
}> = [
  {
    key: "keyPoints",
    title: "핵심 요약",
    description: "공시에서 바로 확인되는 큰 변화입니다.",
  },
  {
    key: "financialHighlights",
    title: "재무 하이라이트",
    description: "XBRL 수치와 MD&A 요약을 함께 표시합니다.",
  },
  {
    key: "businessChanges",
    title: "사업 변화",
    description: "제품·수요·공급 측면의 변화입니다.",
  },
  {
    key: "riskChanges",
    title: "리스크",
    description: "회사 공시가 언급한 주요 위험입니다.",
  },
  {
    key: "watchItems",
    title: "확인 포인트",
    description: "Feno 관점에서 이어서 봐야 할 항목입니다.",
  },
];

const STANCE_LABEL: Record<Stance, string> = {
  fact: "사실",
  management_claim: "경영진 언급",
  feno_interpretation: "Feno 해석",
};

const STANCE_CLASS: Record<Stance, string> = {
  fact: "border-emerald-200 bg-emerald-50 text-emerald-700",
  management_claim: "border-amber-200 bg-amber-50 text-amber-700",
  feno_interpretation: "border-sky-200 bg-sky-50 text-sky-700",
};

function evidenceUrl(evidence: FilingEvidence) {
  if (!evidence.anchor) return evidence.sourceUrl;
  return `${evidence.sourceUrl}#${encodeURIComponent(evidence.anchor)}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
}

const FORM_LABELS_KO: Record<string, string> = {
  "10-K": "연간보고서",
  "10-Q": "분기보고서",
  "8-K": "주요 이벤트 공시",
  "6-K": "해외 발행사 공시",
  "20-F": "해외 연간보고서",
  "13F-HR": "기관 보유 보고",
};

function formLabel(form: string) {
  return FORM_LABELS_KO[form] ?? "SEC 공시";
}

function filingTitle(filing: EdgarKoreanSummaryFilingEntry) {
  return `${formLabel(filing.form)} (${filing.form}) · ${formatDate(filing.filingDate)}`;
}

function FilingCoverageBanner({
  coverage,
  filings,
  symbol,
}: {
  coverage: EdgarKoreanSummaryCoverage | null;
  filings: EdgarKoreanSummaryFilingEntry[];
  symbol: string;
}) {
  const readyCount = filings.filter((filing) => Boolean(filing.summaryPath)).length;
  const tickerCount = coverage?.tickerCount ?? null;
  const updated = coverage?.updated ? formatDate(coverage.updated) : null;

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-black">AI 공시 요약 범위</p>
          <p className="mt-1 text-blue-900">
            현재 {tickerCount ? `${tickerCount.toLocaleString("ko-KR")}종목` : "200종목+"}의 주요 SEC 공시를 한글 요약으로 연결합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-full border border-blue-200 bg-white px-3 py-1">{symbol} 요약 {readyCount.toLocaleString("ko-KR")}건</span>
          <span className="rounded-full border border-blue-200 bg-white px-3 py-1">원문 {filings.length.toLocaleString("ko-KR")}건</span>
          {updated ? <span className="rounded-full border border-blue-200 bg-white px-3 py-1">갱신 {updated}</span> : null}
        </div>
      </div>
    </section>
  );
}

// Plain-Korean labels for SEC section codes so the UI never leaks raw codes
// (item_1a, exhibit_99_1, companyfacts) or English section names to readers.
const SECTION_LABELS_KO: Record<string, string> = {
  item_1: "사업 개요",
  item_1a: "위험요인",
  item_7: "경영실적 분석(MD&A)",
  item_2_02: "실적 발표",
  exhibit_99_1: "실적 보도자료",
  item_3d: "위험요인",
  item_5: "영업·재무 검토",
  risk_factors: "위험요인",
  mda: "경영실적 분석(MD&A)",
  foreign_report: "해외 공시 본문",
  companyfacts: "주요 재무수치",
};

function sectionLabel(_form: string | undefined, section: string | undefined) {
  const key = String(section ?? "").toLowerCase().trim();
  return SECTION_LABELS_KO[key] ?? "주요 공시 항목";
}

// True when the last character carries a Korean final consonant (받침),
// used to pick the correct connective/object particle (과/와, 을/를).
function hasJongseong(word: string) {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function sectionListLabel(form: string | undefined, sections: string[] | undefined) {
  const labels = Array.from(new Set((sections ?? []).map((section) => sectionLabel(form, section))));
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  const head = labels.slice(0, -1).join("·");
  const last = labels[labels.length - 1];
  return `${head}${hasJongseong(head) ? "과" : "와"} ${last}`;
}

function EvidenceList({
  evidenceIds,
  evidenceById,
  form,
}: {
  evidenceIds: string[];
  evidenceById: Map<string, FilingEvidence>;
  form?: string;
}) {
  const evidenceRows = evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((row): row is FilingEvidence => Boolean(row));

  if (evidenceRows.length === 0) {
    return (
      <p className="mt-3 text-xs font-bold text-red-600">
        근거 링크가 연결되지 않은 문장입니다. 원문 확인 전까지 해석에 사용하지 마세요.
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {evidenceRows.map((evidence) => (
        <div
          key={evidence.id}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-slate-500">{evidence.id}</span>
            <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-slate-500">{sectionLabel(form, evidence.section)}</span>
            <a
              href={evidenceUrl(evidence)}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex min-h-7 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              원문 보기
            </a>
          </div>
          <p className="mt-1 text-slate-600">{evidence.sourceTextDigest}</p>
        </div>
      ))}
    </div>
  );
}

function SummarySection({
  title,
  description,
  bullets,
  evidenceById,
  form,
}: {
  title: string;
  description: string;
  bullets: FilingSummaryBullet[];
  evidenceById: Map<string, FilingEvidence>;
  form?: string;
}) {
  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <h2>{title}</h2>
          <p className="desc">{description}</p>
        </div>
      </div>
      <div className="panel-b">
        <div className="grid gap-3">
          {bullets.map((bullet, index) => (
            <article key={`${title}-${index}`} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span
                  className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-bold ${STANCE_CLASS[bullet.stance]}`}
                >
                  {STANCE_LABEL[bullet.stance]}
                </span>
                <p className="min-w-0 flex-1 text-sm font-semibold leading-relaxed text-slate-800">{bullet.text}</p>
              </div>
              <EvidenceList evidenceIds={bullet.evidence} evidenceById={evidenceById} form={form} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function EdgarSummaryClient({
  embedded = false,
  ticker = "NVDA",
}: {
  embedded?: boolean;
  ticker?: string;
}) {
  const symbol = normalizeEdgarTicker(ticker);
  const [filings, setFilings] = useState<EdgarKoreanSummaryFilingEntry[] | null>(null);
  const [coverage, setCoverage] = useState<EdgarKoreanSummaryCoverage | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<EdgarKoreanSummaryArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadEdgarKoreanSummaryCoverage().then((nextCoverage) => {
      if (!cancelled) setCoverage(nextCoverage);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setFilings(null);
        setSelectedPath(null);
        setError(null);
      }
    });
    loadEdgarKoreanSummariesForTicker(symbol)
      .then((manifest) => {
        if (cancelled) return;
        const nextFilings = edgarFilingsForTicker(manifest, symbol);
        setFilings(nextFilings);
        setSelectedPath(nextFilings.find((filing) => filing.summaryPath)?.summaryPath ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setArtifact(null);
        setError(null);
      }
    });
    if (!selectedPath) return () => {
      cancelled = true;
    };
    fetch(selectedPath, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("summary fetch failed");
        return response.json() as Promise<EdgarKoreanSummaryArtifact>;
      })
      .then((payload) => {
        if (!cancelled) setArtifact(payload);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "요약 데이터를 읽지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  const selectedFiling = useMemo(
    () => filings?.find((filing) => filing.summaryPath === selectedPath) ?? filings?.[0] ?? null,
    [filings, selectedPath],
  );

  const evidenceById = useMemo(() => {
    return new Map((artifact?.evidence ?? []).map((row) => [row.id, row]));
  }, [artifact]);

  if (error) {
    return (
      <section className="panel">
        <div className="panel-b">
          <p className="text-sm font-semibold text-red-700">{symbol} 공시 요약 데이터를 불러오지 못했습니다.</p>
          <p className="mt-2 text-sm text-slate-500">잠시 후 다시 확인하거나 SEC 원문과 종목 페이지를 먼저 열어볼 수 있습니다.</p>
          <ExternalSourceLinks ticker={symbol} kind="filing" statusLine="한글 요약 일시 확인 불가" className="mt-4" />
        </div>
      </section>
    );
  }

  if (filings && filings.length === 0) {
    return (
      <div className={embedded ? "stock-main-stack" : "data-shell-page"}>
        <FilingCoverageBanner coverage={coverage} filings={filings} symbol={symbol} />
        <section className="panel">
          <div className="panel-b">
            <p className="text-sm font-semibold text-slate-700">연결된 한글 공시 요약이 없습니다.</p>
            <p className="mt-2 text-sm text-slate-500">
              {symbol}의 10-K, 10-Q, 8-K 한글 요약이 준비되면 이 탭에 자동으로 표시됩니다.
            </p>
            <ExternalSourceLinks ticker={symbol} kind="filing" statusLine="연결된 한글 공시 요약 없음" className="mt-4" />
          </div>
        </section>
      </div>
    );
  }

  if (!filings || (selectedPath && !artifact)) {
    return (
      <section className="panel">
        <div className="panel-b">
          <p className="text-sm font-semibold text-slate-600">{symbol} 공시 요약을 불러오는 중입니다.</p>
        </div>
      </section>
    );
  }

  const displayTicker = artifact?.company.ticker ?? symbol;
  const displayOneLine = artifact?.summaryKo.oneLine ?? selectedFiling?.summaryOneLine ?? "등록된 공시 원문과 요약 상태를 확인합니다.";
  const displaySourceUrl = artifact?.filing.sourceUrl ?? selectedFiling?.sourceUrl;

  return (
    <div className={embedded ? "stock-main-stack" : "data-shell-page"}>
      <section className="panel">
        <div className="data-shell-header">
          <div className="data-shell-head-main">
            <p className="data-shell-kicker">공시 요약</p>
            <h1 className="data-shell-title">{displayTicker} 공시 한글 요약</h1>
            <p className="data-shell-desc">{displayOneLine}</p>
          </div>
          <div className="data-shell-head-actions">
            <span className="data-shell-pill warn"><span />자동 요약</span>
            <span className="data-shell-pill"><span />{filings.length}건</span>
          </div>
        </div>
      </section>

      <FilingCoverageBanner coverage={coverage} filings={filings} symbol={symbol} />

      <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
        <p className="font-bold">자동 생성 요약(AI)입니다. 공식 자료가 아니며, 공시 원문 확인이 필수입니다. 투자권유가 아닙니다.</p>
        <p className="mt-1">
          원문 전체 번역이 아니라 핵심만 추린 요약입니다. 원문에서 추출되지 않은 항목은 아래 출처 카드에 표시되며, 번역이 아직 없는 공시는 원문 링크를 먼저 제공합니다.
        </p>
      </section>

      <section className="panel">
        <div className="panel-h">
          <div>
            <h2>중요 공시</h2>
            <p className="desc">등록된 공시를 고르고 원문과 한글 요약을 함께 확인합니다.</p>
          </div>
        </div>
        <div className="panel-b">
          <div className="grid gap-3">
            {filings.map((filing) => {
              const selected = Boolean(filing.summaryPath) && filing.summaryPath === selectedPath;
              const canShowSummary = Boolean(filing.summaryPath);
              const canShowTranslation = Boolean(filing.translationPath);
              return (
                <article
                  key={`${filing.accession}-${filing.summaryPath}`}
                  className={`rounded-lg border p-3 transition ${selected ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
                    <button
                      type="button"
                      onClick={() => {
                        if (filing.summaryPath) setSelectedPath(filing.summaryPath);
                      }}
                      aria-pressed={selected}
                      className="min-w-0 flex-1 text-left"
                      disabled={!canShowSummary}
                    >
                      <span className="block text-xs font-black text-slate-500">{filingTitle(filing)}</span>
                      <span className="mt-1 block text-sm font-bold text-slate-900">{filing.title}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-slate-500">{filing.summaryOneLine}</span>
                    </button>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={filing.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                      >
                        원문 보기
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          if (filing.summaryPath) setSelectedPath(filing.summaryPath);
                        }}
                        disabled={!canShowSummary}
                        className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-bold transition ${canShowSummary ? "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700" : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"}`}
                      >
                        {canShowSummary ? "요약 보기" : "요약 준비중"}
                      </button>
                      {canShowTranslation && filing.translationPath ? (
                        <a
                          href={filing.translationPath}
                          className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                        >
                          번역 보기
                        </a>
                      ) : (
                        <span className="inline-flex min-h-8 cursor-not-allowed items-center rounded-full border border-slate-200 bg-slate-100 px-3 text-xs font-bold text-slate-400">
                          번역 준비중
                        </span>
                      )}
                    </div>
                  </div>
                  {filing.caveats?.length ? (
                    <ul className="mt-3 grid gap-1 text-xs font-semibold text-amber-700">
                      {filing.caveats.map((caveat) => <li key={caveat}>· {caveat}</li>)}
                    </ul>
                  ) : null}
                  {!canShowSummary ? (
                    <ExternalSourceLinks
                      ticker={symbol}
                      kind="filing"
                      secUrl={filing.sourceUrl}
                      statusLine="한글 요약 준비 전"
                      asOf={filing.filingDate}
                      compact
                      className="mt-3"
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {artifact ? <section className="panel">
        <div className="panel-h">
          <div>
            <h2>공시 출처</h2>
            <p className="desc">원문과 생성 이력을 먼저 확인합니다.</p>
          </div>
          <a href={displaySourceUrl} target="_blank" rel="noreferrer" className="act">
            SEC 원문
          </a>
        </div>
        <div className="panel-b">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs font-bold text-slate-500">회사</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">{artifact.company.name}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs font-bold text-slate-500">공시</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">{selectedFiling ? filingTitle(selectedFiling) : artifact.filing.form}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs font-bold text-slate-500">접수일</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">{formatDate(artifact.filing.filingDate)}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs font-bold text-slate-500">접수번호</dt>
              <dd className="mt-1 break-all font-mono text-xs font-semibold text-slate-800">{artifact.filing.accession}</dd>
            </div>
          </dl>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-bold text-slate-500">요약 생성일</p>
              <p className="mt-1 text-sm text-slate-700">
                {formatDateTime(artifact.generation.generatedAtUtc)} · AI 자동 생성
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-bold text-slate-500">요약 근거</p>
              <p className="mt-1 text-sm text-slate-700">
                {(() => {
                  const basis = sectionListLabel(artifact.filing.form, artifact.sourceStatus.sectionsExtracted);
                  if (!basis) return "이 요약은 공시 원문을 바탕으로 작성했습니다.";
                  return `이 요약은 ${basis}${hasJongseong(basis) ? "을" : "를"} 바탕으로 작성했습니다.`;
                })()}
              </p>
            </div>
          </div>
        </div>
      </section> : (
        <section className="panel">
          <div className="panel-b">
            <p className="text-sm font-semibold text-slate-700">선택한 공시의 한글 요약이 아직 준비되지 않았습니다.</p>
            <ExternalSourceLinks
              ticker={symbol}
              kind="filing"
              secUrl={selectedFiling?.sourceUrl}
              statusLine="한글 요약 준비 전"
              asOf={selectedFiling?.filingDate}
              className="mt-3"
            />
          </div>
        </section>
      )}

      {artifact ? SECTION_LABELS.map((section) => (
        <SummarySection
          key={section.key}
          title={section.title}
          description={section.description}
          bullets={artifact.summaryKo[section.key]}
          evidenceById={evidenceById}
          form={artifact.filing.form}
        />
      )) : null}
    </div>
  );
}
