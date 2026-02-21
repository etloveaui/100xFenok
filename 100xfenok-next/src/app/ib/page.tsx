import type { Metadata } from 'next';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';

export const metadata: Metadata = {
  title: 'IB Helper',
  description: 'Infinite Buying Helper full application',
};

export default function IBPage() {
  return <RouteEmbedFrame src="/ib-helper/index.html" title="100x IB Helper" loading="eager" />;
}
