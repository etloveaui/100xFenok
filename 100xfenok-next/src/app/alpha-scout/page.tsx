import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Alpha Scout',
  description: '숨겨진 투자 기회를 발견하여 알파를 찾는 리서치 리포트',
};

export default function AlphaScoutPage() {
  return (
    <div className="route-embed-shell">
      <iframe
        src="/alpha-scout/alpha-scout-main.html"
        title="100x Alpha Scout"
        className="h-full w-full border-0"
      />
    </div>
  );
}
