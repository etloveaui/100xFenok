import type { Metadata } from 'next';
import AppShell from '@/components/shell/AppShell';
import { ROUTES } from '@/lib/routes';
import '@/styles/cp-w5-macro-chart.css';
import MacroChartClient from '../macro-chart/MacroChartClient';

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: '시장 비교 | 100xFenok',
  description: '여러 자산을 같은 시간축에서 비교하는 차트',
};

export default function MultichartPage() {
  return (
    <div data-multichart-surface="true">
      <AppShell active="chart" title="시장 비교" backHref={ROUTES.macroChart}>
        <MacroChartClient initialMode="stock-compare" />
      </AppShell>
    </div>
  );
}
