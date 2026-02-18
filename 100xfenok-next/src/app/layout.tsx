import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  metadataBase: new URL('https://100x-fenok.vercel.app'),
  title: {
    default: 'FenoK · Investment Knowledge',
    template: '%s | FenoK',
  },
  description: "시장 분석과 투자 전략을 위한 올인원 플랫폼. Market Radar, IB Helper, Alpha Scout, VR 시스템을 제공합니다.",
  keywords: ['주식', '투자', '시장 분석', 'IB Helper', '무한매수', 'Alpha Scout', 'ETF', '리밸런싱'],
  authors: [{ name: 'El Fenomeno' }],
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    siteName: 'FenoK',
    title: 'FenoK · Investment Knowledge',
    description: "시장 분석과 투자 전략을 위한 올인원 플랫폼",
    images: [
      {
        url: '/favicon-96x96.png',
        width: 96,
        height: 96,
        alt: 'FenoK Logo',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'FenoK · Investment Knowledge',
    description: "시장 분석과 투자 전략을 위한 올인원 플랫폼",
    images: ['/favicon-96x96.png'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      </head>
      <body className="antialiased min-h-screen bg-[#f8fafc] overflow-x-hidden">
        <Navbar />
        <main className="pt-14 sm:pt-16">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
