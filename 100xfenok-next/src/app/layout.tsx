import type { Metadata, Viewport } from "next";
import "./globals.css";
import DesignVersionToggle from "@/components/design/DesignVersionToggle";
import { siteOrigin } from "@/lib/site-url";
import { Suspense } from "react";

// Font faces are self-hosted in ./fonts/fonts.css, which also defines
// --font-noto-sans-kr, --font-orbitron-face and --font-jetbrains-mono.
// next/font/google was removed: its build-time fetch is a hard build failure
// surface we do not control.

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
    statusBarStyle: "black-translucent",
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
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8fafc",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" data-theme="light" style={{ colorScheme: "light" }}>
      <body className={`antialiased min-h-screen bg-background text-foreground overflow-x-hidden`}>
        <a href="#main-content" className="skip-link">
          본문으로 건너뛰기
        </a>
        <Suspense fallback={null}>
          <DesignVersionToggle />
        </Suspense>
        <main id="main-content" tabIndex={-1} className="pt-safe-nav">
          {children}
        </main>
      </body>
    </html>
  );
}
