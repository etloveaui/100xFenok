"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getWindDownLiveTalkTopic,
  getWindDownVoiceScenario,
  deriveWindDownVoiceCorrectionPresentation,
} from "@/features/winddown/voice/product";
import type { WindDownVoiceReportReceipt } from "@/features/mona-vnext/memory/learningProfileCoordinator";
import type {
  WindDownConversationPage,
  WindDownConversationSummary,
} from "@/features/winddown/server/conversationHistory";
import {
  extractWindDownVoicePracticeSeeds,
  type WindDownVoicePracticeSeed,
} from "@/features/winddown/voice/practiceSeed";

import { isWindDownVoiceReport, type WindDownVoiceReport } from "@/features/winddown/voice/report";

type ValidatedVoiceReceipt = WindDownVoiceReportReceipt & { report: WindDownVoiceReport };

const CONVERSATIONS_API_ENDPOINT = "/api/winddown/conversations" as const;
const SESSION_ID = /^[A-Za-z0-9._-]{8,160}$/;
function isConversationPage(value: unknown): value is WindDownConversationPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  if (page.ok !== true || !Array.isArray(page.items) || page.items.length > 10
    || !(page.nextCursor === null || (typeof page.nextCursor === "string" && SESSION_ID.test(page.nextCursor)))) return false;
  const ids = new Set<string>();
  return page.items.every((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    if (typeof row.productSessionId !== "string" || !SESSION_ID.test(row.productSessionId) || ids.has(row.productSessionId)
      || (row.activity !== "roleplay" && row.activity !== "live-talk")
      || typeof row.committedAtIso !== "string" || !Number.isFinite(Date.parse(row.committedAtIso))
      || typeof row.scenarioTitle !== "string" || !row.scenarioTitle.trim() || row.scenarioTitle.length > 240
      || typeof row.correctionCount !== "number" || !Number.isSafeInteger(row.correctionCount) || row.correctionCount < 0 || row.correctionCount > 24) return false;
    ids.add(row.productSessionId);
    return true;
  });
}


export default function WindDownVoiceReportHistory() {
  const [items, setItems] = useState<WindDownConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [paginationError, setPaginationError] = useState<string | null>(null);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detailReceipt, setDetailReceipt] = useState<ValidatedVoiceReceipt | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const activeSessionIdRef = useRef<string | null>(null);
  const detailAbortControllerRef = useRef<AbortController | null>(null);

  const fetchConversationsList = useCallback(async (cursor?: string) => {
    const isMore = Boolean(cursor);
    if (isMore) {
      setLoadingMore(true);
      setPaginationError(null);
    } else {
      setLoading(true);
      setInitialError(null);
    }

    try {
      const url = cursor
        ? `${CONVERSATIONS_API_ENDPOINT}?cursor=${encodeURIComponent(cursor)}`
        : CONVERSATIONS_API_ENDPOINT;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("로그인 세션이 필요합니다. 다시 확인해 주세요.");
        }
        throw new Error("대화 목록을 불러오지 못했습니다.");
      }
      const data: unknown = await res.json();
      if (!isConversationPage(data) || (cursor && data.nextCursor === cursor)) {
        throw new Error("대화 목록 응답 형식이 올바르지 않습니다.");
      }

      setItems((prev) => {
        if (!isMore) return data.items;
        // Deduplicate appended identity
        const seen = new Set(prev.map((it) => it.productSessionId));
        const newAdditions = data.items.filter((it) => {
          if (seen.has(it.productSessionId)) return false;
          seen.add(it.productSessionId);
          return true;
        });
        return [...prev, ...newAdditions];
      });
      setNextCursor(data.nextCursor);
    } catch (err) {
      const message = err instanceof Error ? err.message : "대화 목록을 불러오지 못했습니다.";
      if (isMore) {
        setPaginationError(message);
      } else {
        setInitialError(message);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const fetchConversationDetail = useCallback(async (sessionId: string) => {
    if (detailAbortControllerRef.current) {
      detailAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    detailAbortControllerRef.current = controller;
    activeSessionIdRef.current = sessionId;

    setDetailLoading(true);
    setDetailError(null);
    setDetailReceipt(null);

    try {
      const url = `${CONVERSATIONS_API_ENDPOINT}?session=${encodeURIComponent(sessionId)}`;
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("요청한 대화 기록을 찾을 수 없습니다.");
        }
        if (res.status === 401) {
          throw new Error("로그인 세션이 필요합니다. 다시 확인해 주세요.");
        }
        throw new Error("대화 상세 기록을 불러오지 못했습니다.");
      }
      const data = (await res.json()) as { receipt: WindDownVoiceReportReceipt };
      if (!data?.receipt || data.receipt.schemaVersion !== 1
        || typeof data.receipt.committedAtIso !== "string" || !Number.isFinite(Date.parse(data.receipt.committedAtIso))
        || typeof data.receipt.finalDigest !== "string" || !/^[a-f0-9]{64}$/.test(data.receipt.finalDigest)
        || !isWindDownVoiceReport(data.receipt.report)
        || data.receipt.productSessionId !== sessionId
        || data.receipt.report.productSessionId !== sessionId
        || data.receipt.report.activity !== data.receipt.activity) {
        throw new Error("대화 상세 응답 형식이 올바르지 않습니다.");
      }

      // Stale response guard: ensure this response matches the current active session
      if (activeSessionIdRef.current === sessionId) {
        setDetailReceipt({ ...data.receipt, report: data.receipt.report });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Aborted because of session switch or navigating back to list
        return;
      }
      if (activeSessionIdRef.current === sessionId) {
        setDetailError(
          err instanceof Error ? err.message : "대화 상세 기록을 불러오지 못했습니다.",
        );
      }
    } finally {
      if (activeSessionIdRef.current === sessionId) {
        setDetailLoading(false);
      }
    }
  }, []);

  const handleSelectSession = useCallback((sessionId: string | null) => {
    setSelectedSessionId(sessionId);
    activeSessionIdRef.current = sessionId;
    if (detailAbortControllerRef.current) {
      detailAbortControllerRef.current.abort();
      detailAbortControllerRef.current = null;
    }
    if (!sessionId) {
      setDetailReceipt(null);
      setDetailError(null);
      setDetailLoading(false);
    } else {
      void fetchConversationDetail(sessionId);
    }
  }, [fetchConversationDetail]);

  useEffect(() => {
    void fetchConversationsList();
    return () => {
      if (detailAbortControllerRef.current) {
        detailAbortControllerRef.current.abort();
      }
    };
  }, [fetchConversationsList]);

  const detailTitle = useMemo(() => {
    if (!detailReceipt?.report?.descriptor) return "대화 기록";
    const desc = detailReceipt.report.descriptor;
    if (desc.activity === "roleplay") {
      return getWindDownVoiceScenario(desc.scenarioId)?.title ?? "장면 연습";
    }
    return getWindDownLiveTalkTopic(desc.topicId)?.title ?? "자유 대화";
  }, [detailReceipt]);

  const practiceSeeds = useMemo<WindDownVoicePracticeSeed[]>(() => {
    if (!detailReceipt) return [];
    try {
      return extractWindDownVoicePracticeSeeds(detailReceipt);
    } catch {
      return [];
    }
  }, [detailReceipt]);

  return (
    <main
      data-winddown-conversations
      className="mx-auto min-h-[100dvh] w-full max-w-3xl px-5 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8 break-words [overflow-wrap:anywhere]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <Link
          href="/winddown"
          className="inline-flex min-h-[48px] items-center gap-2 text-sm font-semibold text-[var(--wd-muted)] hover:text-[var(--wd-text)]"
        >
          <span aria-hidden="true">←</span> 오늘의 학습
        </Link>
        <Link
          href="/winddown/records"
          className="inline-flex min-h-[48px] items-center gap-2 text-xs font-bold text-[var(--wd-muted)] hover:text-[var(--wd-text)]"
        >
          기록 보관
        </Link>
      </div>

      <header className="mb-8">
        <p className="text-xs font-bold tracking-[.2em] text-[var(--wd-accent)]">WIND DOWN</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">대화 보관함</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--wd-muted)] sm:text-base">
          저장된 역할 대화와 자유 대화 기록을 살펴보고 다시 연습해요.
        </p>
      </header>

      {/* DETAIL VIEW */}
      {selectedSessionId ? (
        <section
          data-conversation-detail
          data-winddown-conversation-detail
          className="grid gap-6 rounded-3xl border border-[var(--wd-border)] bg-[var(--wd-surface)] p-6 sm:p-8"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--wd-border)] pb-4">
            <button
              type="button"
              onClick={() => handleSelectSession(null)}
              className="inline-flex min-h-[48px] items-center gap-2 text-sm font-bold text-[var(--wd-accent)] hover:underline"
            >
              <span aria-hidden="true">←</span> 저장된 대화 목록
            </button>
            {detailReceipt ? (
              <span className="text-xs font-bold text-[var(--wd-muted)]">
                {detailReceipt.activity === "roleplay" ? "역할 대화" : "자유 대화"}
              </span>
            ) : null}
          </div>

          {detailLoading ? (
            <div className="py-12 text-center text-sm font-semibold text-[var(--wd-muted)]">
              대화 기록을 불러오고 있어요...
            </div>
          ) : detailError ? (
            <div role="alert" className="py-8 text-center">
              <p className="text-sm font-bold text-red-500">{detailError}</p>
              <button
                type="button"
                onClick={() => fetchConversationDetail(selectedSessionId)}
                className="mt-4 min-h-[48px] rounded-2xl border border-[var(--wd-border)] px-5 py-3 text-xs font-bold text-[var(--wd-text)]"
              >
                다시 시도
              </button>
            </div>
          ) : detailReceipt ? (
            <div className="space-y-6">
              <div>
                <h2
                  data-winddown-conversation-title
                  className="text-2xl font-black tracking-tight text-[var(--wd-text)]"
                >
                  {detailTitle}
                </h2>
                <p
                  data-winddown-conversation-date
                  className="mt-1 text-xs font-semibold text-[var(--wd-muted)]"
                >
                  저장일시: {detailReceipt.committedAtIso.replace("T", " ").slice(0, 19)} UTC
                </p>
              </div>

              {/* PRACTICE SEEDS (CITED CORRECTIONS WITH ID-ONLY PRACTICE LINKS) */}
              {practiceSeeds.length > 0 ? (
                <div className="rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] p-5">
                  <h3 className="text-sm font-black text-[var(--wd-accent)]">
                    이어서 연습할 문장 ({practiceSeeds.length}개)
                  </h3>
                  <div className="mt-4 space-y-3">
                    {practiceSeeds.map((seed) => (
                      <div
                        key={`${seed.citation.source}:${seed.citation.turn}`}
                        data-winddown-correction-item
                        className="rounded-xl border border-[var(--wd-border)] bg-[var(--wd-surface)] p-4"
                      >
                        <div className="text-xs">
                          <p className="font-semibold text-[var(--wd-muted)]">
                            내 발화:
                          </p>
                          <p className="mt-1 font-bold text-[var(--wd-text)] break-words">
                            {seed.learnerText}
                          </p>
                          <p className="mt-2 font-semibold text-[var(--wd-muted)]">교정 제안:</p>
                          <p className="mt-1 font-bold text-[var(--wd-accent)] break-words">
                            {seed.modelCorrection}
                          </p>
                        </div>
                        <div className="mt-4 flex justify-end">
                          <Link
                            href={seed.practiceUrl}
                            data-winddown-practice-link
                            data-turn-citation={seed.citation.turn}
                            className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[var(--wd-accent)] px-4 py-2 text-xs font-black text-[var(--wd-bg)] hover:opacity-90 active:scale-[.98] motion-reduce:transition-none"
                          >
                            이 문장 드릴 연습하기 →
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* TRANSCRIPT TURNS */}
              <div>
                <h3 className="text-sm font-black text-[var(--wd-text)] mb-3">
                  대화 기록 ({detailReceipt.report.turns.length}턴)
                </h3>
                <div className="space-y-3">
                  {detailReceipt.report.turns.map((turn) => {
                    const correction = detailReceipt.report.outcome.corrections.find(
                      candidate => candidate.conversationId === turn.conversationId && candidate.turnSeq === turn.turnSeq,
                    );
                    const correctionPresentation = correction
                      ? deriveWindDownVoiceCorrectionPresentation(correction)
                      : null;

                    return (
                      <div
                        key={`${turn.conversationId}:${turn.turnSeq}`}
                        className="rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] p-4 text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between text-[11px] font-bold text-[var(--wd-muted)]">
                          <span>대화 #{turn.turnSeq}</span>
                          {turn.interrupted ? (
                            <span className="text-amber-500 font-semibold">끼어들기 있음</span>
                          ) : null}
                        </div>
                        <div>
                          <span className="font-bold text-[var(--wd-text)]">나: </span>
                          <span className="break-words font-medium">{turn.userText}</span>
                        </div>
                        {turn.modelText ? (
                          <div className="border-t border-[var(--wd-border)] pt-2 mt-2">
                            <span className="font-bold text-[var(--wd-muted)]">루미: </span>
                            <span className="break-words font-medium">{turn.modelText}</span>
                          </div>
                        ) : null}

                        {correctionPresentation ? (
                          <div className="mt-2 rounded-xl bg-[var(--wd-surface)] p-3 border border-[var(--wd-border)]">
                            <p className="text-[11px] font-bold text-[var(--wd-accent)]">
                              교정 요약 · was: {correctionPresentation.was} → now: {correctionPresentation.now}
                            </p>
                            <p className="mt-1 text-[11px] text-[var(--wd-muted)]">
                              {correctionPresentation.why}
                            </p>
                          </div>
                        ) : turn.correctionText ? (
                          <div className="mt-2 rounded-xl bg-[var(--wd-surface)] p-3 border border-[var(--wd-border)] text-[11px] font-bold text-[var(--wd-accent)]">
                            {turn.correctionText}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        /* LIST VIEW */
        <section data-winddown-conversation-list className="grid gap-4">
          {loading ? (
            <div className="py-12 text-center text-sm font-semibold text-[var(--wd-muted)]">
              보관된 대화를 불러오고 있어요...
            </div>
          ) : initialError ? (
            <div role="alert" className="rounded-3xl border border-[var(--wd-border)] bg-[var(--wd-surface)] p-6 text-center">
              <p className="text-sm font-bold text-red-500">{initialError}</p>
              <button
                type="button"
                onClick={() => fetchConversationsList()}
                className="mt-4 min-h-[48px] rounded-2xl border border-[var(--wd-border)] px-5 py-3 text-xs font-bold text-[var(--wd-text)]"
              >
                다시 시도
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-3xl border border-[var(--wd-border)] bg-[var(--wd-surface)] p-8 text-center">
              <p className="text-base font-bold text-[var(--wd-text)]">아직 보관된 대화가 없어요.</p>
              <p className="mt-2 text-sm leading-6 text-[var(--wd-muted)]">
                역할 대화나 자유 대화를 진행하면 이곳에 대화 내용과 교정 문장이 안전하게 보관돼요.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link
                  href="/winddown/roleplay"
                  className="inline-flex min-h-[48px] items-center justify-center rounded-2xl bg-[var(--wd-accent)] px-5 py-3 text-sm font-bold text-[var(--wd-bg)]"
                >
                  역할 대화 시작
                </Link>
                <Link
                  href="/winddown/live-talk"
                  className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-[var(--wd-border)] px-5 py-3 text-sm font-bold text-[var(--wd-text)]"
                >
                  자유 대화 시작
                </Link>
              </div>
            </div>
          ) : (
            <>
              {items.map((item) => (
                <button
                  key={item.productSessionId}
                  type="button"
                  data-winddown-conversation-item
                  data-conversation-id={item.productSessionId}
                  onClick={() => handleSelectSession(item.productSessionId)}
                  className="min-h-[48px] w-full text-left rounded-3xl border border-[var(--wd-border)] bg-[var(--wd-surface)] p-5 sm:p-6 transition hover:border-[var(--wd-accent)] active:scale-[.99] motion-reduce:transition-none"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <span className="inline-block rounded-full bg-[var(--wd-bg)] border border-[var(--wd-border)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--wd-muted)] mb-2">
                        {item.activity === "roleplay" ? "역할 대화" : "자유 대화"}
                      </span>
                      <h2
                        data-winddown-conversation-title
                        className="text-lg font-bold tracking-tight text-[var(--wd-text)] break-words"
                      >
                        {item.scenarioTitle}
                      </h2>
                      <p
                        data-winddown-conversation-date
                        className="mt-1 text-xs font-semibold text-[var(--wd-muted)]"
                      >
                        {item.committedAtIso.replace("T", " ").slice(0, 16)} UTC
                      </p>
                    </div>
                    {item.correctionCount > 0 ? (
                      <span className="inline-flex items-center rounded-xl bg-[var(--wd-bg)] border border-[var(--wd-border)] px-3 py-1 text-xs font-black text-[var(--wd-accent)] shrink-0">
                        교정 {item.correctionCount}개
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}

              {paginationError ? (
                <div role="alert" className="rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-surface)] p-4 text-center">
                  <p className="text-xs font-bold text-red-500">{paginationError}</p>
                  <button
                    type="button"
                    onClick={() => fetchConversationsList(nextCursor ?? undefined)}
                    className="mt-3 min-h-[48px] rounded-xl border border-[var(--wd-border)] px-4 py-2 text-xs font-bold text-[var(--wd-text)]"
                  >
                    이어서 다시 시도
                  </button>
                </div>
              ) : null}

              {nextCursor ? (
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => fetchConversationsList(nextCursor)}
                    className="min-h-[48px] w-full rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-surface)] px-5 py-3 text-sm font-bold text-[var(--wd-text)] hover:border-[var(--wd-accent)] disabled:opacity-50"
                  >
                    {loadingMore ? "불러오는 중..." : "더 보기"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}
    </main>
  );
}
