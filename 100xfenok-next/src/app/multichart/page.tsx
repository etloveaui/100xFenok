import type { Metadata } from 'next';
import AppShell from '@/components/shell/AppShell';
import { ROUTES } from '@/lib/routes';
import MacroChartClient from '../macro-chart/MacroChartClient';

export const metadata: Metadata = {
  title: '멀티차트 | 100xFenok',
  description: '여러 자산을 비교하는 멀티차트 도구',
};

export default function MultichartPage() {
  return (
    <div className="fnk-shell" data-multichart-surface="true">
      <AppShell active="chart" title="시장 비교" backHref={ROUTES.macroChart}>
        <MacroChartClient initialMode="stock-compare" />
      </AppShell>
    </div>
  );
}
