import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '100x Market Wrap',
  description: 'AI 기반 멀티에셋 분석으로 시장 핵심 동인을 심층 제공',
};

export default function MarketPage() {
  return (
    <div className="h-[calc(100vh-4rem)] w-full bg-white">
      <iframe
        src="/100x/100x-main.html"
        title="100x Market Wrap"
        className="h-full w-full border-0"
      />
    </div>
  );
}
