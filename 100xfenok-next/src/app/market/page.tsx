import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

export const metadata: Metadata = {
  title: '시장 | 100xFenok',
  description: '시장 밸류에이션과 구조 화면으로 이동합니다.',
};

export default function MarketPage() {
  permanentRedirect(ROUTES.market);
}
