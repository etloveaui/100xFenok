import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '100x IB Helper',
  description: 'Infinite Buying Helper full application',
};

export default function IBPage() {
  return (
    <div className="h-[calc(100vh-4rem)] w-full bg-white">
      <iframe
        src="/ib-helper/index.html"
        title="100x IB Helper"
        className="h-full w-full border-0"
      />
    </div>
  );
}
