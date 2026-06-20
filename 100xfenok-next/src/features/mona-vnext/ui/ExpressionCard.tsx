type Props = {
  ko: string;
  en: string;
  state: "setup" | "prompt" | "reveal" | "repair";
  verdict?: {
    symbol: string;
    label: string;
    detail: string;
  } | null;
};

const STATE_LABEL: Record<Props["state"], string> = {
  setup: "준비",
  prompt: "말해보기",
  reveal: "확인",
  repair: "전환",
};

export function ExpressionCard({ ko, en, state, verdict }: Props) {
  return (
    <section className="rounded-lg border border-[#dfd4c4] bg-[#fffdf8] px-6 py-7 shadow-[0_24px_48px_-28px_rgba(94,74,45,0.35)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#eee8f7] px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-[#7667a5]">
            {STATE_LABEL[state]}
          </span>
          {verdict ? (
            <span
              title={verdict.detail}
              className="rounded-full border border-[#d8ccb9] bg-white px-3 py-1 text-[11px] font-semibold text-[#5f5867]"
            >
              {verdict.symbol} {verdict.label}
            </span>
          ) : null}
        </div>
        <span className="text-[12px] font-semibold text-[#9b8f78]">vNext</span>
      </div>
      <p className="mt-5 text-[24px] font-semibold leading-snug">{ko}</p>
      <p className="mt-5 text-[20px] font-medium leading-snug text-[#6d5d8f]">{en}</p>
    </section>
  );
}
