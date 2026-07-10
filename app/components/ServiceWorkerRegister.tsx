"use client";

// ============================================================
// app/components/ServiceWorkerRegister.tsx
// ------------------------------------------------------------
// PWA-v1.md 5章：public/sw.js を登録する。
// 登録に失敗してもIndexedDBベースの基本機能には影響しないため、
// 失敗時にユーザーへ通知はせず静かに諦める。
//
// 本番ビルドでのみ登録する：next dev（開発モード）はFast Refresh・
// HMR用のライブWebSocket接続・ビルド成果物の非決定性に依存しており、
// Service Workerによるキャッシュとは根本的に相性が悪い
// （Next.js公式・主要なPWA実装でも開発時は無効化するのが通例）。
// オフライン検証は本番ビルド（next build && next start）で行うこと。
// ============================================================

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    } else {
      // 開発モードで過去に登録されたService Workerが残っていれば解除し、
      // 開発中の挙動に古いキャッシュが影響しないようにする。
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      });
    }
  }, []);

  return null;
}
