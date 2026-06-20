import type { MonaVnextBaselineLog, MonaVnextBaselinePromptPolicy } from "@/features/mona-vnext/coach/baselineEvidence";
import type { MonaVnextLessonState } from "@/features/mona-vnext/coach/coachPolicy";
import type { MONA_VNEXT_GEMINI_MODELS, MonaVnextGeminiModel } from "@/features/mona-vnext/live/modelOptions";
import type { MonaVnextLiveStatus, MonaVnextSessionResponse } from "@/features/mona-vnext/live/liveProtocol";
import type { MonaVnextSessionMetrics } from "@/features/mona-vnext/live/useGeminiLiveSession";
import type { MonaVnextLogEvent } from "@/features/mona-vnext/logging/voiceLogSchema";
import type { MonaVnextNamespacePolicy } from "@/features/mona-vnext/memory/monaVnextNamespace";
import type { MonaVnextTranscriptState } from "@/features/mona-vnext/transcript/transcriptStore";
import { ExpressionCard } from "@/features/mona-vnext/ui/ExpressionCard";
import { SessionControls } from "@/features/mona-vnext/ui/SessionControls";

type MonaVnextAnswerVerdict = {
  symbol: string;
  label: string;
  detail: string;
};

type Props = {
  baseline: MonaVnextBaselineLog;
  promptPolicy: MonaVnextBaselinePromptPolicy;
  namespacePolicy: MonaVnextNamespacePolicy;
  status: MonaVnextLiveStatus;
  metrics: MonaVnextSessionMetrics;
  modelOptions: typeof MONA_VNEXT_GEMINI_MODELS;
  selectedModel: MonaVnextGeminiModel;
  onSelectModel: (model: MonaVnextGeminiModel) => void;
  session: MonaVnextSessionResponse | null;
  lessonState: MonaVnextLessonState;
  transcriptState: MonaVnextTranscriptState;
  events: MonaVnextLogEvent[];
  lastPersistedFile: string | null;
  persistenceError: string | null;
  modeLabel: string;
  activeExperimentalFeatures: string[];
  answerVerdict: MonaVnextAnswerVerdict | null;
  onStart: () => void;
  onStop: () => void;
  onSendStart: () => void;
  onRevealAnswer: () => void;
  onNext: () => void;
};

const STATUS_LABEL: Record<MonaVnextLiveStatus, string> = {
  idle: "대기",
  connecting: "연결 중",
  "setup-wait": "준비 중",
  listening: "듣는 중",
  stopping: "정리 중",
  stopped: "멈춤",
  blocked: "차단",
  error: "오류",
};

export function WindDownVnextShell({
  baseline,
  promptPolicy,
  namespacePolicy,
  status,
  metrics,
  modelOptions,
  selectedModel,
  onSelectModel,
  session,
  lessonState,
  transcriptState,
  events,
  lastPersistedFile,
  persistenceError,
  modeLabel,
  activeExperimentalFeatures,
  answerVerdict,
  onStart,
  onStop,
  onSendStart,
  onRevealAnswer,
  onNext,
}: Props) {
  const latestTurns = transcriptState.turns.slice(-3);
  const latestEvents = events.slice(-4);

  return (
    <main className="min-h-dvh bg-[#f7f3ea] px-5 py-[max(env(safe-area-inset-top),24px)] text-[#2f2b33]">
      <section className="mx-auto flex min-h-[calc(100dvh-48px)] w-full max-w-[520px] flex-col">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#857b8d]">Mona vNext</p>
            <h1 className="mt-2 text-[26px] font-semibold leading-tight">격리 음성 테스트</h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full border border-[#dfd4c4] bg-white/80 px-3 py-1 text-[12px] font-semibold text-[#7d6f85]">
              {STATUS_LABEL[status]}
            </span>
            <span className="rounded-full border border-[#dfd4c4] bg-white/70 px-3 py-1 text-[12px] font-semibold text-[#6d5d8f]">
              {modeLabel}
            </span>
            <span className="max-w-[220px] rounded-md border border-[#dfd4c4] bg-white/60 px-3 py-1 text-right text-[11px] font-medium leading-4 text-[#857b8d]">
              {activeExperimentalFeatures.length > 0
                ? activeExperimentalFeatures.join(", ")
                : "실험 기능 없음"}
            </span>
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-center gap-4 py-6">
          <ExpressionCard
            ko={lessonState.expression.ko}
            en={lessonState.englishVisible ? lessonState.expression.en : "English hidden"}
            state={lessonState.expression.state}
            verdict={answerVerdict}
          />

          <section className="rounded-lg border border-[#dfd4c4] bg-white/80 p-4 text-sm leading-6 text-[#5f5867]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#857b8d]">baseline</p>
                <p className="mt-1 font-semibold text-[#2f2b33]">{baseline.dateKst}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#857b8d]">namespace</p>
                <p className="mt-1 font-semibold text-[#2f2b33]">{namespacePolicy.productionWriteEnabled ? "prod" : "owner-test"}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#857b8d]">turns</p>
                <p className="mt-1 font-semibold text-[#2f2b33]">{transcriptState.turns.length}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#857b8d]">frames</p>
                <p className="mt-1 font-semibold text-[#2f2b33]">{metrics.audioFramesSent}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#857b8d]">rms / peak</p>
                <p className="mt-1 font-semibold text-[#2f2b33]">
                  {metrics.lastAudioRms === null ? "-" : metrics.lastAudioRms.toFixed(4)}
                  {" / "}
                  {metrics.lastAudioPeak === null ? "-" : metrics.lastAudioPeak.toFixed(3)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#857b8d]">input Hz</p>
                <p className="mt-1 font-semibold text-[#2f2b33]">{metrics.inputSampleRate ?? "-"}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#857b8d]">reconnects</p>
                <p className="mt-1 font-semibold text-[#2f2b33]">
                  {metrics.reconnectCount}
                  {metrics.lastReconnectMs === null ? "" : ` · ${metrics.lastReconnectMs}ms`}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {modelOptions.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  disabled={status !== "idle" && status !== "stopped" && status !== "error"}
                  onClick={() => onSelectModel(model.id)}
                  className={[
                    "rounded-md border px-3 py-2 text-left text-[12px] font-semibold transition",
                    selectedModel === model.id
                      ? "border-[#6d5d8f] bg-[#f0ecff] text-[#4f3d78]"
                      : "border-[#dfd4c4] bg-white text-[#5f5867]",
                    status !== "idle" && status !== "stopped" && status !== "error"
                      ? "cursor-not-allowed opacity-60"
                      : "hover:border-[#b9a7c9]",
                  ].join(" ")}
                >
                  <span className="block">{model.label}</span>
                  <span className="mt-1 block font-mono text-[10px] font-normal text-[#857b8d]">{model.detail}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[13px]">{promptPolicy.reject[0]}</p>
            {session ? (
              <p className="mt-2 text-[12px] text-[#857b8d]">
                {session.settings.model} · temp {session.settings.temperature} · thinking {session.settings.thinkingLevel} · {session.conversationId}
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-[#dfd4c4] bg-white/65 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#857b8d]">turn log</p>
            <div className="mt-3 space-y-3 text-sm leading-6">
              {latestTurns.length === 0 ? (
                <p className="text-[#7d7484]">아직 완료된 turn이 없습니다.</p>
              ) : latestTurns.map((turn) => (
                <div key={turn.turnSeq} className="border-t border-[#eadfce] pt-3 first:border-t-0 first:pt-0">
                  <p className="font-semibold text-[#2f2b33]">#{turn.turnSeq} · {turn.intent}</p>
                  {turn.userText ? <p className="mt-1 text-[#5f5867]">Mona: {turn.userText}</p> : null}
                  {turn.modelText ? <p className="mt-1 text-[#6d5d8f]">Coach: {turn.modelText}</p> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[#dfd4c4] bg-white/55 p-4 text-[12px] leading-5 text-[#766f7a]">
            <p className="font-semibold uppercase tracking-[0.12em] text-[#857b8d]">events</p>
            <div className="mt-2 space-y-1">
              {latestEvents.length === 0 ? (
                <p>대기 중</p>
              ) : latestEvents.map((event, index) => (
                <p key={`${event.atIso}-${index}`}>{event.type}: {event.message}</p>
              ))}
            </div>
            {lastPersistedFile ? <p className="mt-2 text-[#5f5867]">log: {lastPersistedFile}</p> : null}
            {persistenceError ? (
              <p className="mt-2 rounded-md border border-[#d06a6a] bg-[#fff1f1] px-3 py-2 font-semibold text-[#9b3d3d]">
                저장 실패: {persistenceError}
              </p>
            ) : null}
            {metrics.lastError ? <p className="mt-2 font-semibold text-[#9b3d3d]">{metrics.lastError}</p> : null}
          </section>
        </div>

        <SessionControls
          status={status}
          answerVisible={lessonState.englishVisible}
          onStart={onStart}
          onStop={onStop}
          onSendStart={onSendStart}
          onRevealAnswer={onRevealAnswer}
          onNext={onNext}
        />
      </section>
    </main>
  );
}
