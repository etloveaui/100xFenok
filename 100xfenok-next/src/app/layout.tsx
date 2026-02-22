import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR, Orbitron } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AppEnhancements from "@/components/AppEnhancements";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-noto-sans-kr",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["600", "800", "900"],
  display: "swap",
  variable: "--font-orbitron-face",
});

const siteOrigin = (() => {
  const rawOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "100x-fenok.vercel.app";

  return rawOrigin.startsWith("http") ? rawOrigin : `https://${rawOrigin}`;
})();

const enableVercelRUM = Boolean(
  process.env.VERCEL === "1" || process.env.VERCEL_ENV,
);

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  applicationName: "100x Fenok",
  manifest: "/manifest.webmanifest",
  title: {
    default: "FenoK · Investment Knowledge",
    template: "%s | FenoK",
  },
  description: "시장 분석과 투자 전략을 위한 올인원 플랫폼. Market Radar, IB Helper, Alpha Scout, VR 시스템을 제공합니다.",
  keywords: ["주식", "투자", "시장 분석", "IB Helper", "무한매수", "Alpha Scout", "ETF", "리밸런싱"],
  authors: [{ name: "El Fenomeno" }],
  appleWebApp: {
    capable: true,
    title: "100x Fenok",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "FenoK",
    title: "FenoK · Investment Knowledge",
    description: "시장 분석과 투자 전략을 위한 올인원 플랫폼",
    images: [
      {
        url: "/favicon-96x96.png",
        width: 96,
        height: 96,
        alt: "FenoK Logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "FenoK · Investment Knowledge",
    description: "시장 분석과 투자 전략을 위한 올인원 플랫폼",
    images: ["/favicon-96x96.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#010079",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${notoSansKr.variable} ${orbitron.variable} antialiased min-h-screen bg-[#f8fafc] overflow-x-hidden`}>
        <a href="#main-content" className="skip-link">
          본문으로 건너뛰기
        </a>
        <Navbar />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <Footer />
        <AppEnhancements />
        {enableVercelRUM ? (
          <>
            <Analytics mode="production" />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
