import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Synchro-S",
  description: "Scheduling web app for tutoring academy"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
