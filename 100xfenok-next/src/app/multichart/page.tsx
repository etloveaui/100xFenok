import type { Metadata } from 'next';
import AppShell from '@/components/shell/AppShell';
import MacroChartClient from '../macro-chart/MacroChartClient';

export const metadata: Metadata = {
  title: '멀티차트 | 100xFenok',
  description: '여러 자산을 비교하는 멀티차트 도구',
};

export default function MultichartPage() {
  return (
    <div className="fnk-shell">
      <AppShell active="explore" title="시장 비교" backHref="/explore">
        <MacroChartClient initialMode="stock-compare" />
      </AppShell>
    </div>
  );
}
