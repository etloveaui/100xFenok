import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Sector Heatmap',
  description: '시장 랩 페이지로 이동',
};

export default function SectorsPage() {
  redirect('/market');
}
