type Props = {
  ko: string;
  en: string;
  state: "setup" | "prompt" | "reveal" | "repair";
};

const STATE_LABEL: Record<Props["state"], string> = {
  setup: "준비",
  prompt: "말해보기",
  reveal: "확인",
  repair: "전환",
};

export function ExpressionCard({ ko, en, state }: Props) {
  return (
    <section className="rounded-lg border border-[#dfd4c4] bg-[#fffdf8] px-6 py-7 shadow-[0_24px_48px_-28px_rgba(94,74,45,0.35)]">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-[#eee8f7] px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-[#7667a5]">
          {STATE_LABEL[state]}
        </span>
        <span className="text-[12px] font-semibold text-[#9b8f78]">vNext</span>
      </div>
      <p className="mt-5 text-[24px] font-semibold leading-snug">{ko}</p>
      <p className="mt-5 text-[20px] font-medium leading-snug text-[#6d5d8f]">{en}</p>
    </section>
  );
}
