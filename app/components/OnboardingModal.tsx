"use client";

// ============================================================
// app/components/OnboardingModal.tsx
// ------------------------------------------------------------
// 初回利用時のみ表示する案内。CMSの特徴（ローカルファースト・
// データ保存方式・基本操作）を理解してもらうためのもの。
//
// 確認済みかどうかは lib/localDb.ts の meta ストア（IndexedDB）に
// 保存する。サイトデータが削除されればこのフラグも消えるため、
// その場合は初回扱いとして再表示される（想定通りの挙動）。
// ============================================================

import { useEffect, useState } from "react";
import { hasSeenOnboarding, markOnboardingSeen } from "@/lib/localDb";

export function OnboardingModal() {
  const [checked, setChecked] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    hasSeenOnboarding()
      .then((seen) => setVisible(!seen))
      .catch(() => setVisible(false))
      .finally(() => setChecked(true));
  }, []);

  async function handleConfirm() {
    setVisible(false);
    try {
      await markOnboardingSeen();
    } catch {
      // 記録に失敗しても、このセッション内では案内を閉じたままにする。
    }
  }

  if (!checked || !visible) return null;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card backup-confirm">
        <p className="backup-confirm-text">
          CMS Memory Coreへようこそ。
          <br />
          <br />
          このアプリは、思いついたことや記録を端末内に保存し、後から検索・整理できるメモアプリです。
          <br />
          <br />
          メモはお使いの端末（ブラウザ）内に保存されます。外部のサーバーへ送信されることはありません。
          <br />
          <br />
          ブラウザのサイトデータ削除、端末の初期化、ブラウザ環境の変更などを行うと、保存したメモが失われる場合があります。大切な記録はバックアップ機能を利用してください。
          <br />
          <br />
          「＋メモを書く」から記録を始められます。
        </p>
        <div className="backup-confirm-actions">
          <button type="button" className="btn-backup-confirm" onClick={handleConfirm}>
            はじめる
          </button>
        </div>
      </div>
    </div>
  );
}
