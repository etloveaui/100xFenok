"use client";

import Link from "next/link";
import { useState } from "react";

type Notice = { kind: "idle" | "working" | "verified" | "error"; text: string };
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
class RecordsNoticeError extends Error {}

function errorCopy(code: unknown) {
  if (code === "WINDDOWN_RECOVERY_TOO_LARGE") return "기록이 커서 이 방식으로 처리할 수 없어요. 저장된 기록은 그대로 보관돼요.";
  if (code === "WINDDOWN_RECOVERY_SNAPSHOT_INVALID") return "백업 파일을 확인하지 못했어요. WIND DOWN에서 내려받은 원본 파일을 선택해 주세요.";
  if (code === "ADMIN_SESSION_REQUIRED") return "로그인을 다시 확인한 뒤 시도해 주세요.";
  return "지금은 기록을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}

export default function WindDownRecordsClient() {
  const [file, setFile] = useState<File | null>(null);
  const [download, setDownload] = useState<Notice>({ kind: "idle", text: "" });
  const [recovery, setRecovery] = useState<Notice>({ kind: "idle", text: "" });
  const busy = download.kind === "working" || recovery.kind === "working";

  async function downloadRecords() {
    setDownload({ kind: "working", text: "기록을 모으고 있어요." });
    try {
      const response = await fetch("/api/winddown/records/", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new RecordsNoticeError(errorCopy(body?.error));
      if (body?.kind !== "winddown-coordinator-recovery-snapshot" || !Array.isArray(body.records)) {
        throw new RecordsNoticeError(errorCopy("WINDDOWN_RECOVERY_SNAPSHOT_INVALID"));
      }
      const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `winddown-learning-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDownload({ kind: "verified", text: "백업 파일을 준비했어요. 내려받은 파일을 안전한 곳에 보관해 주세요." });
    } catch (error) {
      setDownload({ kind: "error", text: error instanceof RecordsNoticeError ? error.message : errorCopy(null) });
    }
  }

  async function verifyBackup() {
    if (!file) return;
    setRecovery({ kind: "working", text: "별도 사본에서 복구를 확인하고 있어요." });
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new RecordsNoticeError(errorCopy("WINDDOWN_RECOVERY_TOO_LARGE"));
      let snapshot: unknown;
      try { snapshot = JSON.parse(await file.text()); }
      catch { throw new RecordsNoticeError(errorCopy("WINDDOWN_RECOVERY_SNAPSHOT_INVALID")); }
      const response = await fetch("/api/winddown/records/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      const body = await response.json();
      if (!response.ok) throw new RecordsNoticeError(errorCopy(body?.error));
      if (body?.ok !== true || !Number.isSafeInteger(body.recordCount) || body.recordCount < 0) {
        throw new RecordsNoticeError(errorCopy(null));
      }
      setRecovery({ kind: "verified", text: "복구를 확인했어요" });
    } catch (error) {
      setRecovery({ kind: "error", text: error instanceof RecordsNoticeError ? error.message : errorCopy(null) });
    }
  }

  return (
    <main data-winddown-records className="mx-auto min-h-[100dvh] w-full max-w-3xl px-5 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8">
      <Link href="/winddown" className="inline-flex min-h-[48px] items-center gap-2 text-sm font-semibold text-[var(--wd-muted)]">
        <span aria-hidden="true">←</span> 오늘의 학습
      </Link>
      <header className="mb-9 mt-7">
        <p className="text-xs font-bold tracking-[.2em] text-[var(--wd-accent)]">WIND DOWN</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">학습 기록 보관</h1>
        <p className="mt-4 text-sm leading-7 text-[var(--wd-muted)] sm:text-base">쌓아온 문장과 진도를 파일로 간직해요.</p>
      </header>
      <div className="grid gap-5">
        <section className="rounded-3xl border border-[var(--wd-border)] bg-[var(--wd-surface)] p-6 sm:p-8" aria-labelledby="records-download-title">
          <h2 id="records-download-title" className="text-xl font-bold">기록 내려받기</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--wd-muted)]">학습·복습 진도, 완료 기록, 저장된 대화 보고서와 여정 선택을 함께 보관해요.</p>
          <button type="button" disabled={busy} onClick={() => void downloadRecords()} className="mt-6 min-h-[48px] w-full rounded-2xl bg-[var(--wd-accent)] px-5 py-3 font-bold text-[var(--wd-bg)] disabled:opacity-50 sm:w-auto">
            기록 내려받기
          </button>
          <p role="status" className="mt-3 break-words text-sm leading-6 text-[var(--wd-muted)]">{download.text}</p>
        </section>
        <section className="rounded-3xl border border-[var(--wd-border)] bg-[var(--wd-surface)] p-6 sm:p-8" aria-labelledby="records-recovery-title">
          <h2 id="records-recovery-title" className="text-xl font-bold">복구 가능한지 확인</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--wd-muted)]">백업 파일을 별도 사본에 복구해 대조해요. 지금 학습 중인 기록은 그대로 유지돼요.</p>
          <label htmlFor="winddown-backup-file" className="mt-6 block text-sm font-semibold">백업 파일 선택</label>
          <input id="winddown-backup-file" type="file" accept="application/json,.json" disabled={busy} onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setRecovery({ kind: "idle", text: "" });
          }} className="mt-3 block min-h-[48px] w-full min-w-0 rounded-xl border border-[var(--wd-border)] text-sm text-[var(--wd-muted)] file:mr-3 file:min-h-[48px] file:border-0 file:bg-[var(--wd-surface-raised)] file:px-4 file:font-semibold file:text-[var(--wd-text)]" />
          <button type="button" disabled={!file || busy} onClick={() => void verifyBackup()} className="mt-5 min-h-[48px] w-full rounded-2xl border border-[var(--wd-accent)] px-5 py-3 font-bold text-[var(--wd-accent)] disabled:opacity-50 sm:w-auto">
            복구 확인
          </button>
          <p role="status" data-winddown-recovery-status={recovery.kind} className="mt-3 break-words text-sm leading-6 text-[var(--wd-muted)]">{recovery.text}</p>
        </section>
      </div>
    </main>
  );
}
