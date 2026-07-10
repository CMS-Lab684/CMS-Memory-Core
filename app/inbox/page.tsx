"use client";

// ============================================================
// app/inbox/page.tsx
// ------------------------------------------------------------
// メモの記録画面。
//
// フェーズ1の方針：
//   タイトル・本文は必須。ユーザータグは任意。
//   AIによる自動整理・タイトル補完は行わない。
//   過去に使ったタグを候補として表示し、クリックで追加できるようにする。
//
// Phase1 Step2-1：サーバーAPI（/api/notes, /api/tags）を廃止し、
// lib/localDb.ts（IndexedDB）に直接読み書きするよう変更した。
// この画面単体での動作確認を優先し、他の画面（一覧・詳細・検索）は
// まだ旧SQLite/APIのままのため、ここで保存したメモはそれらの画面には
// まだ表示されない（Step2の以降のステップで順次接続する）。
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  parseTagsInput,
  FUTURE_VALUES,
  FutureValue,
  assertTitleLength,
  assertBodyLength,
  normalizeAndValidateTags,
} from "@/lib/utils";
import { createNote, getTagHistory } from "@/lib/localDb";

export default function InboxPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [userTagsInput, setUserTagsInput] = useState("");
  const [tagHistory, setTagHistory] = useState<string[]>([]);
  const [futureValue, setFutureValue] = useState<FutureValue>("未評価");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getTagHistory()
      .then((tags) => setTagHistory(tags))
      .catch(() => setTagHistory([]));
  }, []);

  function handleTagChipClick(tag: string) {
    const current = parseTagsInput(userTagsInput);
    if (current.includes(tag)) return;
    const next = [...current, tag].join(" ");
    setUserTagsInput(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    if (!body.trim()) {
      setError("本文を入力してください");
      return;
    }
    setError("");
    setSubmitting(true);

    try {
      // Ver1入力制限仕様：UI側でも保存処理（lib/localDb.ts）と同じ
      // 検証関数を使い、上限を超える場合は早めにエラーを表示する。
      assertTitleLength(title.trim());
      assertBodyLength(body);
      const userTags = normalizeAndValidateTags(parseTagsInput(userTagsInput));

      await createNote({ title, body, userTags, futureValue });

      // 保存後は詳細画面ではなく一覧画面へ。新しい順で一番上に表示されるため、
      // 保存されたことがすぐ分かる。
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "保存中にエラーが発生しました。もう一度お試しください。"
      );
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>メモを書く</h1>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="title">タイトル</label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：〇〇プロジェクトの反省点"
          />
        </div>

        <div className="form-group">
          <label htmlFor="body">本文</label>
          <textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="思ったこと、経験したこと、知ったことを自由に書いてください"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="userTags">
            ユーザータグ（任意・スペースかカンマ区切り）
          </label>
          <input
            id="userTags"
            type="text"
            value={userTagsInput}
            onChange={(e) => setUserTagsInput(e.target.value)}
            placeholder="例：重要 記事ネタ CMS改善"
            autoComplete="off"
          />
          <p className="field-hint">
            自分自身の意図や「これを何に使いたいか」を残すためのタグです。
            後から検索・絞り込みに使えます。
          </p>

          {tagHistory.length > 0 && (
            <div className="tag-history">
              {tagHistory.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="tag tag-user tag-chip-button"
                  onClick={() => handleTagChipClick(tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="form-group">
          <label>あとで役立つ（任意・後から変更できます）</label>
          <div className="future-value-selector">
            {FUTURE_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                className={`fv-option fv-${v} ${
                  futureValue === v ? "fv-selected" : ""
                }`}
                onClick={() => setFutureValue(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p style={{ color: "#b3452e", fontSize: 13, marginBottom: 12 }}>
            {error}
          </p>
        )}

        <button className="btn-submit" disabled={submitting}>
          {submitting ? "保存しています…" : "保存する"}
        </button>
      </form>
    </div>
  );
}
