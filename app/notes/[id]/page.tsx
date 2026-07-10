"use client";

// ============================================================
// app/notes/[id]/page.tsx
// ------------------------------------------------------------
// メモ詳細画面。
//
// フェーズ1の方針：
//   AIによる自動整理は行わない。
//   「あとで役立つ」評価（高/中/低/未評価）はユーザー自身が選択・変更する。
//   ユーザータグはユーザーが自由に追加・削除できる。
//   本文は常に全文表示する（途中で切り取らない）。
//
// 過去タグ履歴（入力補助）はここでは表示しない。
// タグ履歴は「入力画面」の役割とし、詳細画面は
// 「このメモに今設定されているタグ」のみを見せる、と役割を分けている。
//
// Phase1 Step2-3：本文・タグ・あとで役立つ評価の取得／更新を
// fetch("/api/notes/:id")（SQLite）から getNote()/updateNote()
// （lib/localDb.ts, IndexedDB）に置き換えた。
// Phase1 Step2-4：メモ削除（handleDelete）も
// fetch("/api/notes/:id", {method:"DELETE"})（SQLite）から
// deleteNote()（lib/localDb.ts, IndexedDB）に置き換えた。
//
// Ver1入力制限仕様：タグ追加時にも、保存処理（lib/localDb.ts）と同じ
// 検証関数（normalizeAndValidateTags）を使い、上限を超える場合は
// エラーメッセージを表示する。
// ============================================================

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  FUTURE_VALUES,
  FutureValue,
  parseTagsInput,
  normalizeAndValidateTags,
} from "@/lib/utils";
import { getNote, updateNote as updateNoteInDb, deleteNote } from "@/lib/localDb";

type NoteDetail = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  user_tags: string[];
  future_value: string;
};

export default function NoteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [savingFutureValue, setSavingFutureValue] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [tagError, setTagError] = useState("");

  async function load() {
    const found = await getNote(String(params.id));
    if (!found) {
      setNotFound(true);
      return;
    }
    setNote({
      id: found.id,
      title: found.title,
      body: found.body,
      created_at: found.createdAt,
      user_tags: found.userTags,
      future_value: found.futureValue,
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function updateNote(patch: {
    userTags?: string[];
    futureValue?: FutureValue;
  }) {
    const updated = await updateNoteInDb(String(params.id), patch);
    setNote((prev) =>
      prev
        ? { ...prev, user_tags: updated.userTags, future_value: updated.futureValue }
        : prev
    );
  }

  async function handleFutureValueChange(value: FutureValue) {
    setSavingFutureValue(true);
    await updateNote({ futureValue: value });
    setSavingFutureValue(false);
  }

  async function handleAddTag(e: React.FormEvent) {
    e.preventDefault();
    if (!note) return;
    setTagError("");
    // スペース・カンマ区切りで複数タグとして追加できるようにする
    const newTags = parseTagsInput(newTag).filter(
      (t) => !note.user_tags.includes(t)
    );
    setNewTag("");
    if (newTags.length === 0) return;
    try {
      // Ver1入力制限仕様：既存タグ＋新規タグの合計に対して
      // 1タグの文字数・タグ数の上限を検証する。
      const merged = normalizeAndValidateTags([...note.user_tags, ...newTags]);
      await updateNote({ userTags: merged });
    } catch (err) {
      setTagError(
        err instanceof Error ? err.message : "タグの追加に失敗しました。"
      );
    }
  }

  async function handleRemoveTag(tag: string) {
    if (!note) return;
    await updateNote({ userTags: note.user_tags.filter((t) => t !== tag) });
  }

  // メモ削除：確認画面でユーザーが承諾した場合のみ、このメモ1件だけを削除する。
  // 他のメモやバックアップ機能には一切影響しない。
  async function handleDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteNote(String(params.id));
      router.push("/");
    } catch (err) {
      setDeleting(false);
      setDeleteError("削除に失敗しました。もう一度お試しください。");
    }
  }

  if (notFound) {
    return <p className="empty-state">メモが見つかりませんでした。</p>;
  }

  if (!note) {
    return <p className="empty-state">読み込み中…</p>;
  }

  return (
    <div>
      <Link href="/" className="back-link">
        ← 一覧に戻る
      </Link>

      <h1>{note.title}</h1>
      <p className="subtitle">{formatDate(note.created_at)} に記録</p>

      {/* --- 本文：常に全文表示する。記録画面と同じ流れで、まず本文を確認できるようにする --- */}
      <div className="detail-section">
        <h2>本文</h2>
        <p className="detail-body">{note.body}</p>
      </div>

      {/* --- あとで役立つ：AIは推定しない。ユーザーが自分で判断・変更する --- */}
      <div className="detail-section">
        <h2>あとで役立つ</h2>
        <p className="field-hint" style={{ marginBottom: 10 }}>
          この記録を未来の自分がどれくらい見返しそうか、あなた自身の感覚で設定してください。
          いつでも変更できます。
        </p>
        <div className="future-value-selector">
          {FUTURE_VALUES.map((v) => (
            <button
              key={v}
              type="button"
              className={`fv-option fv-${v} ${
                note.future_value === v ? "fv-selected" : ""
              }`}
              onClick={() => handleFutureValueChange(v)}
              disabled={savingFutureValue}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* --- ユーザータグ：ユーザー自身の意図・未来利用目的を残す --- */}
      <div className="detail-section">
        <h2>ユーザータグ</h2>
        <div style={{ marginBottom: 10 }}>
          {note.user_tags.length === 0 && (
            <span className="field-hint">まだユーザータグはありません</span>
          )}
          {note.user_tags.map((tag) => (
            <span key={tag} className="tag tag-user tag-removable">
              <button
                type="button"
                className="tag-link-button"
                onClick={() => router.push(`/search?q=${encodeURIComponent(tag)}`)}
                title="このタグで過去メモを検索"
              >
                #{tag}
              </button>
              <button
                type="button"
                className="tag-remove-btn"
                onClick={() => handleRemoveTag(tag)}
                aria-label={`${tag}を削除`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={handleAddTag} className="tag-add-form">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="例：記事ネタ 重要"
            autoComplete="off"
          />
          <button type="submit" className="btn-submit-small">
            追加
          </button>
        </form>
        {tagError && (
          <p style={{ color: "#b3452e", fontSize: 13, marginTop: 8 }}>
            {tagError}
          </p>
        )}
      </div>

      {/* --- メモ管理：このメモに対する管理系の操作をまとめる --- */}
      <div className="detail-section detail-section-danger">
        <h2>メモ管理</h2>
        {!confirmingDelete ? (
          <button
            type="button"
            className="btn-delete"
            onClick={() => setConfirmingDelete(true)}
          >
            削除
          </button>
        ) : (
          <div className="delete-confirm">
            <p className="delete-confirm-text">
              このメモを削除しますか？
              <br />
              削除すると元に戻せません。
              <br />
              必要な場合は先にバックアップしてください。
            </p>
            <div className="delete-confirm-actions">
              <button
                type="button"
                className="btn-delete-confirm"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "削除しています…" : "削除する"}
              </button>
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                キャンセル
              </button>
            </div>
            {deleteError && (
              <p style={{ color: "#b3452e", fontSize: 13, marginTop: 10 }}>
                {deleteError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d
    .getHours()
    .toString()
    .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
