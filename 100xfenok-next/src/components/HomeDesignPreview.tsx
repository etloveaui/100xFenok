import Link from "next/link";

type PreviewCard =
  | {
      id: string;
      kicker: string;
      title: string;
      summary: string;
      type: "sector";
      chips: string[];
      leaders: string[];
      laggards: string[];
      cta: string;
    }
  | {
      id: string;
      kicker: string;
      title: string;
      summary: string;
      type: "metric";
      metric: string;
      sublabel: string;
      bars: Array<{ height: string; down?: boolean }>;
      footer: string;
      cta: string;
    }
  | {
      id: string;
      kicker: string;
      title: string;
      summary: string;
      type: "stat";
      rows: Array<{ label: string; value: string; tone?: "up" | "down" | "neutral" }>;
      cta: string;
    }
  | {
      id: string;
      kicker: string;
      title: string;
      summary: string;
      type: "health";
      status: string;
      detail: string;
      cta: string;
      stress?: string;
    };

type VariantTone = {
  frame: string;
  kicker: string;
  panel: string;
  chip: string;
  cta: string;
  rail: string;
  metric: string;
};

const previewCards: PreviewCard[] = [
  {
    id: "sector",
    kicker: "섹터 흐름",
    title: "Breadth Expansion",
    summary: "최근 강세와 약세 섹터를 한눈에 요약합니다.",
    type: "sector",
    chips: ["XLK +1.6%", "XLY +0.1%", "XLC -0.5%", "XLU -1.1%"],
    leaders: ["XLK +1.6%", "XLY +0.1%", "XLC -0.5%"],
    laggards: ["XLB -4.0%", "XLI -3.1%", "XLP -2.3%"],
    cta: "강약 섹터 흐름 보기",
  },
  {
    id: "liquidity",
    kicker: "유동성",
    title: "Funding Pulse",
    summary: "대출과 예금 흐름으로 유동성 방향을 봅니다.",
    type: "metric",
    metric: "+$27.6B",
    sublabel: "대출 흐름이 개선되고 있습니다.",
    bars: [
      { height: "26%", down: true },
      { height: "42%" },
      { height: "58%" },
      { height: "34%" },
      { height: "50%" },
    ],
    footer: "예대율 71.5%",
    cta: "대출·예금 흐름 보기",
  },
  {
    id: "sentiment",
    kicker: "투자 심리",
    title: "Risk Appetite",
    summary: "변동성과 옵션, 암호화폐 심리를 함께 봅니다.",
    type: "stat",
    rows: [
      { label: "VIX", value: "24.93 높음", tone: "up" },
      { label: "Put/Call", value: "0.84 중립", tone: "neutral" },
      { label: "Crypto F&G", value: "13 극단적 공포", tone: "down" },
    ],
    cta: "VIX·옵션 심리 보기",
  },
  {
    id: "banking",
    kicker: "금융 건전성",
    title: "Funding Stress Guard",
    summary: "연체율, 예대율, 자본비율로 은행권 상태를 봅니다.",
    type: "health",
    status: "안정",
    detail: "연체율 1.47% · 자본비율 14.17% · 예대율 71.5%",
    cta: "은행 건전성 보기",
  },
  {
    id: "stress",
    kicker: "시장 스트레스",
    title: "Stress Monitor",
    summary: "금리와 하이일드 스프레드로 위험 강도를 봅니다.",
    type: "health",
    status: "낮음",
    detail: "HY 3.13% · UST10Y 4.15%",
    stress: "0.16",
    cta: "금리·스프레드 보기",
  },
];

const variantTones: Array<{
  id: "A" | "B" | "C";
  name: string;
  shortLabel: string;
  summary: string;
  recommendation: string;
  emphasis: string;
  tone: VariantTone;
}> = [
  {
    id: "A",
    name: "Quiet Brief",
    shortLabel: "보수형",
    summary: "현재 구조를 거의 유지하고, 여백과 톤만 정리하는 안입니다.",
    recommendation: "운영 리스크 최소",
    emphasis: "차분한 카드, 얕은 그림자, 약한 강조",
    tone: {
      frame: "border border-slate-200 bg-white shadow-[0_10px_24px_-20px_rgba(15,23,42,0.35)]",
      kicker: "border border-slate-200 bg-slate-50 text-slate-600",
      panel: "border border-slate-200 bg-white",
      chip: "border border-slate-200 bg-slate-50 text-slate-700",
      cta: "border border-slate-300 bg-white text-slate-800",
      rail: "from-slate-200 via-slate-300 to-slate-200",
      metric: "text-slate-900",
    },
  },
  {
    id: "B",
    name: "Briefing Deck",
    shortLabel: "추천",
    summary: "금융 브리핑 앱 느낌으로 카드 위계와 CTA를 또렷하게 만든 안입니다.",
    recommendation: "추천",
    emphasis: "pill kicker, panel 분리, 강한 CTA 흐름",
    tone: {
      frame: "border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_55%,#eef4ff_100%)] shadow-[0_18px_38px_-28px_rgba(15,23,42,0.45)]",
      kicker: "border border-blue-200 bg-blue-50 text-blue-700",
      panel: "border border-slate-200 bg-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
      chip: "border border-blue-100 bg-white text-slate-700",
      cta: "border border-blue-200 bg-white text-slate-900",
      rail: "from-[#010079]/20 via-[#1b73d3]/45 to-[#7a5a00]/30",
      metric: "text-brand-navy",
    },
  },
  {
    id: "C",
    name: "Signal Board",
    shortLabel: "강조형",
    summary: "정보 밀도와 상태 대비를 올려 단말기 같은 인상을 주는 안입니다.",
    recommendation: "체감 변화 큼",
    emphasis: "짙은 rail, 강한 수치, 또렷한 상태 대비",
    tone: {
      frame: "border border-slate-300 bg-[linear-gradient(180deg,#ffffff_0%,#f3f7fb_52%,#edf2f7_100%)] shadow-[0_22px_42px_-30px_rgba(15,23,42,0.52)]",
      kicker: "border border-brand-navy/25 bg-slate-900 text-white",
      panel: "border border-slate-300 bg-white shadow-[0_12px_22px_-18px_rgba(15,23,42,0.3)]",
      chip: "border border-slate-300 bg-slate-100 text-slate-800",
      cta: "border border-slate-900 bg-slate-900 text-white",
      rail: "from-[#010079] via-[#1b73d3] to-[#7a5a00]",
      metric: "text-slate-950",
    },
  },
];

const progressOptions = [
  {
    id: "P1",
    title: "Nav 바로 아래",
    summary: "현재 개념 유지. sticky nav와 붙여서 상단 시스템 UI처럼 보이게 합니다.",
    recommended: false,
    barPosition: "top-10",
  },
  {
    id: "P2",
    title: "본문 컨테이너 시작점",
    summary: "카드 영역 시작과 맞물리게 두어 읽는 흐름과 연결합니다.",
    recommended: true,
    barPosition: "top-24",
  },
  {
    id: "P3",
    title: "모바일 하단 dock 위",
    summary: "모바일만 진행 바를 아래로 내려 thumb(손가락) 영역과 연결합니다.",
    recommended: false,
    barPosition: "bottom-12",
  },
];

const dockOptions = [
  {
    id: "D1",
    title: "핵심 라우트만",
    summary: "현재 방식. 홈, 마켓, 인사이트, 전략 계열만 노출합니다.",
    routes: ["/", "/market", "/alpha-scout", "/posts*", "/ib", "/vr"],
  },
  {
    id: "D2",
    title: "모든 공개 페이지",
    summary: "admin과 인증 화면만 빼고 public 라우트 전역에 표시합니다.",
    routes: ["/", "/market", "/sectors", "/posts", "/multichart", "/radar", "/ib", "/vr"],
    recommended: true,
  },
  {
    id: "D3",
    title: "전역 + opt-out",
    summary: "기본은 전역 노출, full-screen embed 페이지에서만 코드로 끄는 방식입니다.",
    routes: ["public 전체", "embed/fullscreen만 opt-out"],
  },
];

function toneForRow(tone?: "up" | "down" | "neutral") {
  if (tone === "up") return "text-emerald-700";
  if (tone === "down") return "text-amber-700";
  return "text-slate-700";
}

function renderPreviewCard(card: PreviewCard, tone: VariantTone) {
  if (card.type === "sector") {
    return (
      <>
        <div className={`rounded-2xl p-3 ${tone.panel}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-700">
              <span className="size-2 rounded-full bg-emerald-500" />
              상승 2
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-700">
              <span className="size-2 rounded-full bg-rose-500" />
              하락 9
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {card.chips.map((chip) => (
              <span key={chip} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.chip}`}>
                {chip}
              </span>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`rounded-2xl p-3 ${tone.panel}`}>
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">강한 섹터</p>
            <div className="mt-2 space-y-2">
              {card.leaders.map((item) => (
                <div key={item} className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-sm font-bold text-emerald-800">
                  <span>{item.split(" ")[0]}</span>
                  <span>{item.split(" ")[1]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={`rounded-2xl p-3 ${tone.panel}`}>
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">약한 섹터</p>
            <div className="mt-2 space-y-2">
              {card.laggards.map((item) => (
                <div key={item} className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-sm font-bold text-rose-800">
                  <span>{item.split(" ")[0]}</span>
                  <span>{item.split(" ")[1]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  if (card.type === "metric") {
    return (
      <>
        <div className={`rounded-2xl p-4 ${tone.panel}`}>
          <p className={`text-4xl font-black tracking-tight ${tone.metric}`}>{card.metric}</p>
          <p className="mt-2 text-sm font-semibold text-slate-600">{card.sublabel}</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone.panel}`}>
          <div className="flex h-12 items-end gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-2 py-2">
            {card.bars.map((bar, index) => (
              <span
                key={`${card.id}-${index}`}
                className={`flex-1 rounded-t-md ${bar.down ? "bg-gradient-to-t from-rose-600 to-orange-400" : "bg-gradient-to-t from-emerald-700 to-emerald-400"}`}
                style={{ height: bar.height }}
              />
            ))}
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-600">{card.footer}</p>
        </div>
      </>
    );
  }

  if (card.type === "stat") {
    return (
      <div className={`rounded-2xl p-3 ${tone.panel}`}>
        <div className="divide-y divide-slate-200">
          {card.rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="font-semibold text-slate-500">{row.label}</span>
              <strong className={`font-black ${toneForRow(row.tone)}`}>{row.value}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`rounded-2xl p-4 ${tone.panel}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(34,197,94,0.14)]" />
            <strong className="text-lg font-black text-slate-900">{card.status}</strong>
          </div>
          {card.stress ? <span className={`text-4xl font-black tracking-tight ${tone.metric}`}>{card.stress}</span> : null}
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-600">{card.detail}</p>
      </div>
    </>
  );
}

function PreviewVariant({ variant }: { variant: (typeof variantTones)[number] }) {
  return (
    <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">
              Variant {variant.id}
            </span>
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${
              variant.recommendation === "추천"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-600"
            }`}>
              {variant.shortLabel}
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{variant.name}</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">{variant.summary}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{variant.emphasis}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">추천 포인트</p>
          <p className="mt-1 text-sm font-bold text-slate-800">{variant.recommendation}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {previewCards.slice(0, 3).map((card) => (
          <article key={`${variant.id}-${card.id}`} className={`relative overflow-hidden rounded-[1.35rem] p-4 ${variant.tone.frame}`}>
            <div className={`absolute inset-x-4 top-0 h-1 rounded-full bg-gradient-to-r ${variant.tone.rail}`} />
            <div className="relative">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${variant.tone.kicker}`}>
                {card.kicker}
              </span>
              <h3 className="mt-3 text-xl font-black tracking-tight text-slate-950">{card.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{card.summary}</p>
              <div className="mt-4 space-y-4">
                {renderPreviewCard(card, variant.tone)}
              </div>
              <button type="button" className={`mt-4 flex min-h-11 w-full items-center justify-between rounded-2xl px-4 text-sm font-black ${variant.tone.cta}`}>
                <span>{card.cta}</span>
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {previewCards.slice(3).map((card) => (
          <article key={`${variant.id}-${card.id}`} className={`relative overflow-hidden rounded-[1.35rem] p-4 ${variant.tone.frame}`}>
            <div className={`absolute inset-x-4 top-0 h-1 rounded-full bg-gradient-to-r ${variant.tone.rail}`} />
            <div className="relative">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${variant.tone.kicker}`}>
                {card.kicker}
              </span>
              <h3 className="mt-3 text-xl font-black tracking-tight text-slate-950">{card.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{card.summary}</p>
              <div className="mt-4 space-y-4">
                {renderPreviewCard(card, variant.tone)}
              </div>
              <button type="button" className={`mt-4 flex min-h-11 w-full items-center justify-between rounded-2xl px-4 text-sm font-black ${variant.tone.cta}`}>
                <span>{card.cta}</span>
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProgressOptionCard({
  title,
  summary,
  barPosition,
  recommended,
}: {
  title: string;
  summary: string;
  barPosition: string;
  recommended?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-black text-slate-950">{title}</h3>
          <p className="mt-2 text-sm text-slate-600">{summary}</p>
        </div>
        {recommended ? (
          <span className="inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
            추천
          </span>
        ) : null}
      </div>
      <div className="mt-4 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-3">
        <div className="relative mx-auto h-44 w-[220px] overflow-hidden rounded-[1.25rem] border border-slate-300 bg-white shadow-[0_20px_28px_-22px_rgba(15,23,42,0.45)]">
          <div className="h-11 border-b border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-600">NAV</div>
          <div className={`absolute left-0 right-0 h-[3px] bg-gradient-to-r from-[#010079] via-[#1b73d3] to-[#7a5a00] ${barPosition}`} />
          <div className="px-4 py-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-500">콘텐츠 영역</div>
            <div className="mt-3 grid gap-2">
              <div className="h-10 rounded-xl border border-slate-200 bg-white" />
              <div className="h-10 rounded-xl border border-slate-200 bg-white" />
            </div>
          </div>
          <div className="absolute inset-x-3 bottom-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-[11px] font-bold text-slate-500">
            MOBILE DOCK
          </div>
        </div>
      </div>
    </article>
  );
}

export default function HomeDesignPreview() {
  return (
    <div className="space-y-6">
      <section className="rounded-[1.75rem] border border-slate-200 bg-gradient-to-r from-slate-950 via-brand-navy to-brand-interactive p-5 text-white shadow-[0_26px_55px_-38px_rgba(2,6,23,0.92)]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">Admin Only Preview</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Home Design Preview</h1>
        <p className="mt-3 max-w-3xl text-sm text-white/85">
          이 화면은 아직 메인에 적용하지 않은 비교안입니다. 카드 스타일, 스크롤 진행 바 위치, 모바일 하단 dock 범위를 보고 조합을 고르면 그다음 메인에 반영합니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em]">
            메인 미적용
          </span>
          <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em]">
            선택 후 반영
          </span>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">추천 조합</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">B안 카드 + P2 진행 바 + D2 dock 범위</h2>
            <p className="mt-2 text-sm text-slate-600">
              지금 사이트 톤을 크게 깨지 않으면서도 카드 위계가 분명해지고, 모바일 하단 dock도 공개 페이지 전역으로 정리하기 좋은 조합입니다.
            </p>
          </div>
          <Link
            href="/admin"
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            Admin Hub로 돌아가기
          </Link>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">1. Card Variants</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">카드 구역 비교안</h2>
          <p className="mt-2 text-sm text-slate-600">A/B/C를 한 화면에서 보고 골라주면 됩니다.</p>
        </div>
        {variantTones.map((variant) => (
          <PreviewVariant key={variant.id} variant={variant} />
        ))}
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">2. Progress Bar Position</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">스크롤 진행 바 위치안</h2>
          <p className="mt-2 text-sm text-slate-600">
            현재 선은 페이지가 얼마나 남았는지를 보여주는 요소로 보고, 위치만 다시 정하는 비교안입니다.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
          {progressOptions.map((option) => (
            <ProgressOptionCard key={option.id} {...option} />
          ))}
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">3. Mobile Dock Scope</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">모바일 하단 dock 범위안</h2>
          <p className="mt-2 text-sm text-slate-600">
            지금은 일부 공개 페이지에만 보입니다. 여기서 범위를 고르면 그 규칙으로 통일합니다.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
          {dockOptions.map((option) => (
            <article key={option.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-black text-slate-950">{option.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{option.summary}</p>
                </div>
                {option.recommended ? (
                  <span className="inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
                    추천
                  </span>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {option.routes.map((route) => (
                  <span key={`${option.id}-${route}`} className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700">
                    {route}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
