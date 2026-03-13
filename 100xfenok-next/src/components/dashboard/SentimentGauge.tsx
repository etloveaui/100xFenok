import { clamp } from '@/lib/dashboard/formatters';

type SentimentGaugeProps = {
  fearGreedScore: number;
  fearGreedLabel: string;
};

export default function SentimentGauge({ fearGreedScore, fearGreedLabel }: SentimentGaugeProps) {
  const fearGreedOffset = Number((126 * (1 - clamp(fearGreedScore, 0, 100) / 100)).toFixed(2));
  const fearGreedBadgeClass = fearGreedScore >= 55
    ? 'bg-green-100 text-green-800'
    : fearGreedScore <= 45
      ? 'bg-red-100 text-red-700'
      : 'bg-amber-100 text-amber-800';

  return (
    <div className="bento-card p-4">
      <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">Sentiment</h3>
      <div className="flex items-center gap-3">
        <div className="relative w-16 h-8">
          <svg viewBox="0 0 100 50" className="w-full h-full" aria-hidden="true">
            <defs>
              <linearGradient id="gaugeFinal" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="50%" stopColor="#eab308" />
                <stop offset="100%" stopColor="#22c55e" />
              </linearGradient>
            </defs>
            <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
            <path
              d="M 10 45 A 40 40 0 0 1 90 45"
              fill="none"
              stroke="url(#gaugeFinal)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="126"
              strokeDashoffset={fearGreedOffset}
            />
          </svg>
        </div>
        <span className="text-2xl font-bold text-brand-navy orbitron">{Math.round(fearGreedScore)}</span>
        <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${fearGreedBadgeClass}`}>{fearGreedLabel}</span>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        공포·탐욕 지수와 변동성 흐름을 합쳐 시장의 온도를 요약합니다.
      </p>
    </div>
  );
}
