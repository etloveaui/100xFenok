import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Sector Heatmap',
  description: '대시보드 Sectors 탭으로 이동',
};

export default function SectorsPage() {
  redirect('/');
}
