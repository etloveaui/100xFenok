import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "FenoK · Investment Knowledge",
  description: "Investment knowledge and market tools.",
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
      <body className="antialiased min-h-screen bg-[#f8fafc]">
        <Navbar />
        <main className="pt-14 sm:pt-16">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
