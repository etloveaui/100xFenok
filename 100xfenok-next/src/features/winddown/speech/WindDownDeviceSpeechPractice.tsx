"use client";

import { useWindDownDeviceSpeech } from "@/features/winddown/speech/useWindDownDeviceSpeech";

type Props = {
  targetText: string;
  controls: "listen-and-speak" | "speak-only";
  disabled?: boolean;
  showMatchFeedback?: boolean;
  onTranscript?: (transcript: string) => void;
};

const MATCH_COPY = {
  match: "문장이 그대로 들렸어.",
  close: "거의 같은 문장으로 들렸어.",
  different: "다르게 들린 부분이 있어. 한 번 더 천천히 말해 봐.",
} as const;

export function WindDownDeviceSpeechPractice({
  targetText,
  controls,
  disabled = false,
  showMatchFeedback = true,
  onTranscript,
}: Props) {
  const speech = useWindDownDeviceSpeech({ targetText, onTranscript });
  const listening =
    speech.phase === "requesting" || speech.phase === "listening";

  return (
    <section
      aria-label="기기 음성 연습"
      className="mt-5 rounded-2xl border border-[var(--wd-border)] bg-[var(--wd-bg)] p-3"
    >
      <div className="flex gap-2">
        {controls === "listen-and-speak" ? (
          <button
            type="button"
            disabled={disabled || !speech.support.synthesis}
            onClick={speech.speak}
            className="min-h-11 flex-1 rounded-xl border border-[var(--wd-border)] bg-[var(--wd-surface-raised)] px-3 text-xs font-black text-[var(--wd-text)] disabled:opacity-35"
          >
            {speech.phase === "speaking" ? "읽는 중…" : "문장 듣기"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled || !speech.support.recognition}
          onClick={listening ? speech.stop : speech.startListening}
          className="min-h-11 flex-1 rounded-xl bg-[var(--wd-listening)] px-3 text-xs font-black text-[var(--wd-bg)] disabled:opacity-35"
        >
          {speech.phase === "requesting"
            ? "마이크 여는 중…"
            : speech.phase === "listening"
              ? "듣는 중 · 멈추기"
              : "말로 답하기"}
        </button>
      </div>

      {speech.phase === "heard" ? (
        <div aria-live="polite" className="mt-3 text-center">
          <p className="text-xs font-bold text-[var(--wd-text-muted)]">
            기기가 들은 문장
          </p>
          <p className="mt-1 text-sm font-black text-[var(--wd-text)]">
            “{speech.transcript}”
          </p>
          <p className="mt-1 text-xs font-bold text-[var(--wd-listening)]">
            {showMatchFeedback && speech.match
              ? MATCH_COPY[speech.match]
              : onTranscript
                ? "받아쓴 문장을 입력칸에 옮겼어. 확인한 뒤 제출해 줘."
                : "기기가 들은 문장만 확인했어. 복습 답과 점수에는 반영하지 않아."}
          </p>
        </div>
      ) : null}

      {speech.phase === "error" && speech.message ? (
        <p
          role="status"
          className="mt-3 text-center text-xs font-bold leading-5 text-[var(--wd-warning)]"
        >
          {speech.message}
        </p>
      ) : null}

      <p className="mt-3 text-center text-[10px] font-bold leading-4 text-[var(--wd-text-muted)]">
        대화 모델은 열지 않아. 받아쓰기는 브라우저 설정과 네트워크 상태에
        따라 달라지고, 브라우저에 따라 음성이 기기 밖 서비스에서 처리될 수
        있어. 발음 점수나 학습 보상으로 저장하지 않아.
      </p>
    </section>
  );
}
