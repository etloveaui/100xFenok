import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sector Heatmap - 100xFenok',
  description: 'Real-time sector performance heatmap - Coming Soon',
};

export default function SectorsPage() {
  return (
    <div className="h-[calc(100vh-4rem)] w-full bg-slate-50 flex items-center justify-center">
      <div className="text-center">
        <div className="text-6xl mb-4">📊</div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Sector Heatmap</h1>
        <p className="text-slate-500">Coming Soon</p>
        <p className="text-sm text-slate-400 mt-2">Real-time sector performance visualization</p>
      </div>
    </div>
  );
}
