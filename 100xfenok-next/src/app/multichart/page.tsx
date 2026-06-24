import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: '멀티차트',
  description: '매크로 차트로 이동합니다.',
};

export default function MultichartPage() {
  redirect('/macro-chart');
}
