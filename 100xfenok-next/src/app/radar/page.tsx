import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Market Radar',
  description: '거시경제 지표 통합 대시보드',
};

export default function RadarPage() {
  return (
    <div className="route-embed-shell">
      <iframe
        src="/tools/macro-monitor/index.html"
        title="100x Market Radar"
        className="h-full w-full border-0"
      />
    </div>
  );
}
