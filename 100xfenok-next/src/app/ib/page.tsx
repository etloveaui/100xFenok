import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'IB Helper',
  description: 'Infinite Buying Helper full application',
};

export default function IBPage() {
  return (
    <div className="route-embed-shell">
      <iframe
        src="/ib-helper/index.html"
        title="100x IB Helper"
        className="h-full w-full border-0"
      />
    </div>
  );
}
