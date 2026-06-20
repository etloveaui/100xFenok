"use client";

import { useEffect, useMemo, useState } from "react";

const ARTIFACT_URL = "/data/edgar-korean-summaries/pilot/nvda-10-k-0001045810-26-000021.json";

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

function EvidenceList({
  evidenceIds,
  evidenceById,
}: {
  evidenceIds: string[];
  evidenceById: Map<string, FilingEvidence>;
}) {
  const evidenceRows = evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((row): row is FilingEvidence => Boolean(row));

  if (evidenceRows.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {evidenceRows.map((evidence) => (
        <div
          key={evidence.id}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-slate-500">{evidence.id}</span>
            <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-slate-500">{evidence.section}</span>
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
}: {
  title: string;
  description: string;
  bullets: FilingSummaryBullet[];
  evidenceById: Map<string, FilingEvidence>;
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
              <EvidenceList evidenceIds={bullet.evidence} evidenceById={evidenceById} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function EdgarSummaryPilotClient({ embedded = false }: { embedded?: boolean }) {
  const [artifact, setArtifact] = useState<EdgarKoreanSummaryArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(ARTIFACT_URL, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`SUMMARY_FETCH_FAILED:${response.status}`);
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
  }, []);

  const evidenceById = useMemo(() => {
    return new Map((artifact?.evidence ?? []).map((row) => [row.id, row]));
  }, [artifact]);

  if (error) {
    return (
      <section className="panel">
        <div className="panel-b">
          <p className="text-sm font-semibold text-red-700">NVDA 공시 요약 데이터를 불러오지 못했습니다.</p>
          <p className="mt-2 font-mono text-xs text-slate-500">{error}</p>
        </div>
      </section>
    );
  }

  if (!artifact) {
    return (
      <section className="panel">
        <div className="panel-b">
          <p className="text-sm font-semibold text-slate-600">NVDA 10-K 요약을 불러오는 중입니다.</p>
        </div>
      </section>
    );
  }

  return (
    <div className={embedded ? "stock-main-stack" : "data-shell-page"}>
      <section className="panel">
        <div className="data-shell-header">
          <div className="data-shell-head-main">
            <p className="data-shell-kicker">EDGAR SUMMARY PILOT</p>
            <h1 className="data-shell-title">{artifact.company.ticker} 10-K 자동 요약</h1>
            <p className="data-shell-desc">{artifact.summaryKo.oneLine}</p>
          </div>
          <div className="data-shell-head-actions">
            <span className="data-shell-pill warn"><span />PILOT</span>
            <span className="data-shell-pill"><span />NVDA ONLY</span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
        <p className="font-bold">자동 생성 요약(AI)입니다. 공식 자료가 아니며, 공시 원문 확인이 필수입니다. 투자권유가 아닙니다.</p>
        <p className="mt-1">
          현재는 파일럿 화면으로 {artifact.company.ticker} {artifact.filing.form} 한 건만 제공합니다. Item 1은 이번 추출에서
          빠졌고, 화면은 Item 1A·Item 7·XBRL 재무수치만 사용합니다.
        </p>
      </section>

      <section className="panel">
        <div className="panel-h">
          <div>
            <h2>공시 출처</h2>
            <p className="desc">원문과 생성 이력을 먼저 확인합니다.</p>
          </div>
          <a href={artifact.filing.sourceUrl} target="_blank" rel="noreferrer" className="act">
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
              <dd className="mt-1 text-sm font-semibold text-slate-800">{artifact.filing.form}</dd>
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
              <p className="text-xs font-bold text-slate-500">생성 이력</p>
              <p className="mt-1 text-sm text-slate-700">
                {formatDateTime(artifact.generation.generatedAtUtc)} · {artifact.generation.model} · 비용 ${artifact.generation.costUsedUsd}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-bold text-slate-500">추출 범위</p>
              <p className="mt-1 text-sm text-slate-700">
                사용: {artifact.sourceStatus.sectionsExtracted.join(", ")} · 누락: {artifact.sourceStatus.missingSections.join(", ")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {SECTION_LABELS.map((section) => (
        <SummarySection
          key={section.key}
          title={section.title}
          description={section.description}
          bullets={artifact.summaryKo[section.key]}
          evidenceById={evidenceById}
        />
      ))}
    </div>
  );
}
