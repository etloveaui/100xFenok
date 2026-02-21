import type { Metadata } from 'next';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';

export const metadata: Metadata = {
  title: 'Multichart Pro',
  description: '레버리지 ETF까지 지원하는 초고속 브라우저 기반 멀티차트',
};

export default function MultichartPage() {
  return <RouteEmbedFrame src="/tools/asset/multichart.html" title="100x Multichart Pro" loading="eager" />;
}
