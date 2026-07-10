"use client";

// ============================================================
// app/components/NoteCard.tsx
// ------------------------------------------------------------
// 一覧画面・検索画面で共通して使うメモカード。
// タイトル・ユーザータグ・あとで役立つ評価・作成日時のみを表示する
// （本文を途中で切り取った要約は表示しない）。
// タグをクリックすると onTagClick が呼ばれ、呼び出し元で
// 検索や絞り込みに使う。
//
// onDeleted を渡した画面（一覧画面）でのみ削除ボタンを表示する。
// 検索画面など、onDeleted を渡さない画面には表示されない。
//
// Phase1 Step2-4：削除処理を fetch("/api/notes/:id", {method:"DELETE"})
// （SQLite）から deleteNote()（lib/localDb.ts, IndexedDB）に置き換えた。
//
// 削除確認中（confirmingDelete）・削除実行中（deleting）は、カード全体を
// 覆う<Link>のクリックによる詳細画面への遷移を無効化する。小さいボタンへの
// 誤クリックでカード側にクリックが抜けても、削除処理と同時に詳細画面へ
// 遷移してしまう競合（「メモが見つかりません」表示の原因になり得る）を防ぐため。
// ============================================================

import { useState } from "react";
import Link from "next/link";
import { deleteNote } from "@/lib/localDb";

export type Note = {
  id: string;
  title: string;
  created_at: string;
  user_tags: string[];
  future_value: string;
};

export function NoteCard({
  note,
  onTagClick,
  onDeleted,
}: {
  note: Note;
  onTagClick: (tag: string) => void;
  onDeleted?: (id: string) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      await deleteNote(note.id);
      onDeleted?.(note.id);
    } catch {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <Link
      href={`/notes/${note.id}`}
      className="note-card"
      onClick={(e) => {
        if (confirmingDelete || deleting) {
          e.preventDefault();
        }
      }}
    >
      <div className="note-card-top">
        <span className="note-title">{note.title}</span>
        <span className="note-date">{formatDate(note.created_at)}</span>
      </div>

      <div className="note-card-badges">
        <span className={`badge-fv fv-${note.future_value}`} title="あとで役立つ">
          {note.future_value}
        </span>
      </div>

      {note.user_tags.length > 0 && (
        <div className="note-card-tags">
          {note.user_tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="tag tag-user tag-chip-button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTagClick(tag);
              }}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {onDeleted && (
        <div className="note-card-actions">
          {!confirmingDelete ? (
            <button
              type="button"
              className="note-card-delete-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setConfirmingDelete(true);
              }}
            >
              削除
            </button>
          ) : (
            <span
              className="note-card-delete-confirm"
              onClick={(e) => e.preventDefault()}
            >
              <span className="note-card-delete-confirm-text">
                削除しますか？元に戻せません。
              </span>
              <button
                type="button"
                className="btn-delete-confirm"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "削除中…" : "削除する"}
              </button>
              <button
                type="button"
                className="btn-cancel"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setConfirmingDelete(false);
                }}
                disabled={deleting}
              >
                キャンセル
              </button>
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
