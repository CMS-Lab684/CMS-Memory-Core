"use client";

// ============================================================
// app/components/HeaderSearch.tsx
// ------------------------------------------------------------
// どの画面からでもアクセスできる常時表示の検索窓。
// 今見ているメモから「関連する過去メモ」をすぐ探せるようにするための
// CMSの主要機能。入力して送信すると検索画面（/search）へ遷移する。
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";

export function HeaderSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    router.push(`/search?q=${encodeURIComponent(value)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="header-search">
      <input
        type="text"
        placeholder="過去メモを検索"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}
