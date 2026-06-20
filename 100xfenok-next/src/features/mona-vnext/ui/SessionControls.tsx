import type { MonaVnextLiveStatus } from "@/features/mona-vnext/live/liveProtocol";

type Props = {
  status: MonaVnextLiveStatus;
  answerVisible: boolean;
  onStart: () => void;
  onStop: () => void;
  onSendStart: () => void;
  onRevealAnswer: () => void;
  onNext: () => void;
};

export function SessionControls({
  status,
  answerVisible,
  onStart,
  onStop,
  onSendStart,
  onRevealAnswer,
  onNext,
}: Props) {
  const live = status === "listening" || status === "setup-wait" || status === "connecting";
  const busy = status === "connecting" || status === "setup-wait" || status === "stopping";
  const commandDisabled = !live || busy;

  return (
    <footer className="flex items-center justify-between gap-3 pb-[max(env(safe-area-inset-bottom),24px)]">
      <button
        type="button"
        disabled={busy}
        onClick={live ? onStop : onStart}
        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-[#8a7ab8] bg-white/85 text-[#8a7ab8] shadow-[0_20px_40px_-24px_rgba(94,74,45,0.45)] transition active:scale-[0.98] disabled:opacity-55"
        aria-label={live ? "vNext voice session stop" : "vNext voice session start"}
      >
        <span
          aria-hidden
          className={live ? "h-7 w-7 rounded-sm bg-current" : "h-7 w-7 rounded-full border-2 border-current"}
        />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={commandDisabled}
            onClick={onRevealAnswer}
            className="min-h-11 rounded-lg border border-[#dfd4c4] bg-white/80 px-3 text-[13px] font-semibold text-[#5f5867] transition active:scale-[0.99] disabled:opacity-45"
          >
            {answerVisible ? "정답 다시 보기" : "정답 보기"}
          </button>
          <button
            type="button"
            disabled={commandDisabled}
            onClick={onNext}
            className="min-h-11 rounded-lg border border-[#8a7ab8] bg-[#8a7ab8] px-3 text-[13px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-45"
          >
            다음
          </button>
        </div>
        <button
          type="button"
          disabled={commandDisabled}
          onClick={onSendStart}
          className="min-h-11 rounded-lg border border-[#dfd4c4] bg-white/70 px-4 text-left text-[13px] font-semibold text-[#5f5867] transition active:scale-[0.99] disabled:opacity-45"
        >
          시작 멘트 보내기
        </button>
      </div>
      <p className="w-20 text-right text-[13px] font-medium text-[#857b8d]">{live ? "Live" : "Ready"}</p>
    </footer>
  );
}
