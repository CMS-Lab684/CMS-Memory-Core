"use client";

// ============================================================
// app/search/page.tsx
// ------------------------------------------------------------
// 過去のメモを探すための専用画面。
// ヘッダーの常時検索窓や、メモカード・詳細画面のタグクリックから
// ?q=キーワード付きで遷移してくる。
//
// 「一覧」画面＝記録を見る場所（並び替えて全件を眺める）。
// 「検索」画面＝過去の資産を探す場所。
// キーワード未入力時は「最近のメモ（新しい順）」を一覧表示し、
// 入力するとタイトル・本文・ユーザータグを対象に絞り込む。
// 検索結果自体も並び替えられるようにし、単なる一覧ではなく
// 「整理して探せる」画面にする。
//
// Phase1 Step2-5：検索処理を fetch("/api/notes?q=...&sort=...")
// （SQLite）から searchNotes()（lib/localDb.ts, IndexedDB）に
// 置き換えた。並び替え・検索条件（タイトル・本文・ユーザータグ、
// キーワード未入力時は新しい順の全件）の意味は変えていない。
// ============================================================

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NoteCard, Note } from "@/app/components/NoteCard";
import { searchNotes } from "@/lib/localDb";

type SortOption = "new" | "old" | "value" | "updated";

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="empty-state">読み込み中…</p>}>
      <SearchPageInner />
    </Suspense>
  );
}

function SearchPageInner() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [sort, setSort] = useState<SortOption>("new");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const searched = query.trim().length > 0;

  const runSearch = useCallback(async (q: string, sortValue: SortOption) => {
    setLoading(true);
    const localNotes = await searchNotes(q, sortValue);
    setNotes(
      localNotes.map((n) => ({
        id: n.id,
        title: n.title,
        created_at: n.createdAt,
        user_tags: n.userTags,
        future_value: n.futureValue,
      }))
    );
    setLoading(false);
  }, []);

  // 入力のたびに検索するとAPI呼び出しが増えすぎるため、軽いデバウンスをかける
  useEffect(() => {
    const timer = setTimeout(() => runSearch(query, sort), 300);
    return () => clearTimeout(timer);
  }, [query, sort, runSearch]);

  return (
    <div>
      <h1>メモを検索</h1>
      <p className="subtitle">
        {searched
          ? `「${query}」の検索結果`
          : "最近の記録（新しい順）。キーワードでタイトル・本文・タグを絞り込めます。"}
      </p>

      <div className="list-controls">
        <input
          className="search-box"
          placeholder="タイトル・本文・ユーザータグで検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <select
          className="sort-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
        >
          <option value="new">新しい順</option>
          <option value="old">古い順</option>
          <option value="value">あとで役立つ順（高→低）</option>
          <option value="updated">更新順</option>
        </select>
      </div>

      {loading && <p className="empty-state">読み込み中…</p>}

      {!loading && notes.length === 0 && (
        <p className="empty-state">
          {searched
            ? "一致するメモが見つかりませんでした。"
            : "まだ記録がありません。"}
        </p>
      )}

      {notes.map((note) => (
        <NoteCard key={note.id} note={note} onTagClick={(tag) => setQuery(tag)} />
      ))}
    </div>
  );
}
