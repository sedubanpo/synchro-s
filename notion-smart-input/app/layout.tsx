import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Noto_Sans_KR, Orbitron } from "next/font/google";
import "./globals.css";

const bodyFont = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body"
});

const displayFont = Orbitron({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--font-display"
});

export const metadata: Metadata = {
  title: "Notion Smart Input",
  description: "자연어 입력을 분석해 Notion 특이사항 DB에 자동 등록하는 앱"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${bodyFont.variable} ${displayFont.variable} bg-[#070b17] text-slate-100 antialiased`}>
        {children}
      </body>
    </html>
  );
}
