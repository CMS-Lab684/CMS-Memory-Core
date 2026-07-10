import "./globals.css";
import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { HeaderSearch } from "./components/HeaderSearch";
import { ServiceWorkerRegister } from "./components/ServiceWorkerRegister";
import { OnboardingModal } from "./components/OnboardingModal";

// PWA Level1（PWA-v1.md）：manifestはapp/manifest.tsのファイル規約で
// 自動配信・自動リンクされるため、ここに追記する必要はない。
export const metadata: Metadata = {
  title: "CMS Memory Core",
  description: "過去が未来に活き続ける世界。",
};

export const viewport: Viewport = {
  themeColor: "#3d5a4c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <ServiceWorkerRegister />
        <OnboardingModal />
        <header className="app-header">
          <Link href="/" className="logo">
            CMS <span>Memory Core</span>
          </Link>
          {/* どの画面からでも過去メモをすぐ探せる常時検索窓（中央配置） */}
          <HeaderSearch />
          <nav>
            <Link href="/">一覧</Link>
            <Link href="/inbox" className="btn-primary-small">
              ＋ メモを書く
            </Link>
            <Link href="/search">検索</Link>
          </nav>
        </header>
        <main className="app-main">{children}</main>
      </body>
    </html>
  );
}
