import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KIIYA 見落としチェッカー",
  description: "職員向け清掃作業・確認記録",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
