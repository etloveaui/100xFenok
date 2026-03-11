import type { Metadata } from 'next';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';

export const metadata: Metadata = {
  title: '멀티차트',
  description: '여러 자산을 비교하는 멀티차트 도구',
};

export default function MultichartPage() {
  return (
    <RouteEmbedFrame
      src="/tools/asset/multichart.html"
      title="100x 멀티차트"
      loading="eager"
      timeoutMs={20000}
    />
  );
}
