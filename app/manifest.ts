// ============================================================
// app/manifest.ts
// ------------------------------------------------------------
// Next.js App Routerの標準機能（ファイル規約）でWeb App Manifestを
// 生成する。Next.jsがこのファイルを検出し、自動的に
// /manifest.webmanifest として配信し、<head>にリンクタグを追加する。
//
// PWA-v1.md 2章・4章の方針に基づき、ローカルファースト（IndexedDB）
// 構成には一切手を加えない。
//
// アイコンは正式デザイン（public/icon/配下のPNG）を使用する。
// 192×192・512×512の2サイズを用意し、ホーム画面追加時・
// インストール時に正しいアイコンが表示されるようにしている。
// ============================================================

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CMS Memory Core",
    short_name: "CMS Memory",
    description:
      "過去が未来に活き続ける世界。ローカルファーストのメモ管理アプリ。",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eef1ec",
    theme_color: "#3d5a4c",
    icons: [
      {
        src: "/icon/CMSMemoryCore_icon_192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon/CMSMemoryCore_icon_512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
