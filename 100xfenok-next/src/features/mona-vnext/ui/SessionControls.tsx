import type { MonaVnextLiveStatus } from "@/features/mona-vnext/live/liveProtocol";

type Props = {
  status: MonaVnextLiveStatus;
  onStart: () => void;
  onStop: () => void;
  onSendStart: () => void;
};

export function SessionControls({ status, onStart, onStop, onSendStart }: Props) {
  const live = status === "listening" || status === "setup-wait" || status === "connecting";
  const busy = status === "connecting" || status === "setup-wait" || status === "stopping";

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
      <button
        type="button"
        disabled={!live || busy}
        onClick={onSendStart}
        className="min-h-12 flex-1 rounded-lg border border-[#dfd4c4] bg-white/70 px-4 text-left text-[14px] font-semibold text-[#5f5867] transition active:scale-[0.99] disabled:opacity-45"
      >
        시작 멘트 보내기
      </button>
      <p className="w-20 text-right text-[13px] font-medium text-[#857b8d]">{live ? "Live" : "Ready"}</p>
    </footer>
  );
}
