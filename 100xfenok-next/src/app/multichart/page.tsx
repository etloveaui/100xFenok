import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '100x Multichart Pro',
  description: '레버리지 ETF까지 지원하는 초고속 브라우저 기반 멀티차트',
};

export default function MultichartPage() {
  return (
    <div className="h-[calc(100vh-4rem)] w-full bg-white">
      <iframe
        src="/tools/asset/multichart.html"
        title="100x Multichart Pro"
        className="h-full w-full border-0"
      />
    </div>
  );
}
