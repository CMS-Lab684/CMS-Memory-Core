"use client";

// ============================================================
// app/page.tsx
// ------------------------------------------------------------
// メモ一覧画面。全件を並び替えて眺めるための画面。
// 初めて使う人でも迷わないよう、「＋ メモを書く」への導線を
// ページ上部に大きく置く。
//
// キーワードで探したい場合は「検索」タブ（/search）または
// ヘッダーの常時検索窓を使う想定のため、この画面には検索ボックスは置かない。
//
// フェーズ1の方針：
//   AIによる自動整理は行わない。表示するのは
//   タイトル・ユーザータグ・あとで役立つ評価・作成日時のみ。
//   本文を途中で切り取った要約は表示しない（元の意味を変えないため）。
//
// Phase1 Step2-2：一覧の取得元を fetch("/api/notes")（SQLite）から
// getAllNotes()（lib/localDb.ts, IndexedDB）に変更した。並び替えの
// 意味（new/old/value）はSQLite版のORDER BYと同じ結果になるよう
// lib/localDb.ts 側で揃えてある。
// Phase1 Step2-6：バックアップ／復元も fetch("/api/backup"系)（SQLite）
// から exportBackup()/previewRestore()/commitRestore()
// （lib/localDb.ts, IndexedDB）に置き換えた。JSON形式・比較ルールは
// SPEC-v1.md 6章に準拠する。
// ============================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NoteCard, Note } from "@/app/components/NoteCard";
import {
  getAllNotes,
  exportBackup,
  previewRestore,
  commitRestore,
  RestorePreview,
} from "@/lib/localDb";

type SortOption = "new" | "old" | "value";

export default function HomePage() {
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [sort, setSort] = useState<SortOption>("new");
  const [loading, setLoading] = useState(true);
  const [confirmingBackup, setConfirmingBackup] = useState(false);
  const [backing, setBacking] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRestoreData = useRef<unknown>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(
    null
  );
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [restoreMessage, setRestoreMessage] = useState("");

  const fetchNotes = useCallback(async (sortValue: SortOption) => {
    setLoading(true);
    const localNotes = await getAllNotes(sortValue);
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

  useEffect(() => {
    fetchNotes(sort);
  }, [sort, fetchNotes]);

  // メモデータをJSONファイルとしてダウンロードする。IndexedDBから読み取るのみで、
  // 既存データは一切変更しない。外部（サーバー）への送信は発生しない。
  async function handleBackup() {
    setBacking(true);
    setBackupMessage("");
    try {
      const backup = await exportBackup();
      const text = JSON.stringify(backup, null, 2);

      const filename = `CMS_backup_${todayString()}.json`;
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setBackupMessage(
        `保存が完了しました。${backup.noteCount}件のメモを「${filename}」としてダウンロードしています。\n` +
          `このJSONファイルは、そのまま読んで内容を確認するための通常のメモファイルではありません。\n` +
          `将来、CMS Memory Coreにこのファイルを読み込むことで、この時点の状態に復元するためのデータです。\n` +
          `このファイルはお使いの端末に保存されるだけで、外部には送信されません。元のデータもそのまま残っています。`
      );
    } catch (err) {
      setBackupMessage("バックアップに失敗しました。もう一度お試しください。");
    } finally {
      setBacking(false);
      setConfirmingBackup(false);
    }
  }

  // 「復元」ボタン：隠しファイル入力を開く
  function handleRestoreButtonClick() {
    setRestoreError("");
    setRestoreMessage("");
    fileInputRef.current?.click();
  }

  // バックアップJSONファイルを選択した直後：中身を読み込み、IndexedDBと比較（プレビュー）する。
  // この時点ではIndexedDBは一切変更されない。
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 同じファイルを選び直しても onChange が発火するようにする
    if (!file) return;

    setRestoreError("");
    setRestoreMessage("");
    setRestorePreview(null);

    // JSONとして読めないファイル（壊れたファイル・関係ないファイル）は、
    // 技術的なエラー文言をそのまま見せず、常に同じ案内メッセージにする。
    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      setRestoreError(
        "このファイルを読み込めませんでした。CMSからダウンロードしたバックアップファイル（.json）を選択してください。"
      );
      return;
    }

    // ここから先の検証エラー（対応していない形式・別アプリのファイル等）は、
    // previewRestore側で用意した具体的な案内文をそのまま表示する。
    try {
      setRestoring(true);
      const preview = await previewRestore(parsed);
      pendingRestoreData.current = parsed;
      setRestorePreview(preview);
    } catch (err) {
      pendingRestoreData.current = null;
      setRestoreError(
        err instanceof Error
          ? err.message
          : "このファイルを読み込めませんでした。CMSからダウンロードしたバックアップファイル（.json）を選択してください。"
      );
    } finally {
      setRestoring(false);
    }
  }

  // ユーザーが内容を確認したうえで復元を実行する。
  // 追加・更新のみ行い、既存メモの削除は一切行わない。
  async function handleConfirmRestore() {
    if (!pendingRestoreData.current) return;
    setRestoring(true);
    try {
      const result = await commitRestore(pendingRestoreData.current);
      setRestoreMessage(
        `復元が完了しました。追加 ${result.added}件、更新 ${result.changed}件（変更なし ${result.unchanged}件）。` +
          `現在の合計は${result.totalAfter}件です。`
      );
      fetchNotes(sort);
    } catch (err) {
      setRestoreError("復元に失敗しました。もう一度お試しください。");
    } finally {
      setRestoring(false);
      setRestorePreview(null);
      pendingRestoreData.current = null;
    }
  }

  function handleCancelRestore() {
    setRestorePreview(null);
    pendingRestoreData.current = null;
  }

  function handleNoteDeleted(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <div>
      <h1>記憶の一覧</h1>
      <p className="subtitle">過去が未来に活き続ける世界。</p>

      <Link href="/inbox" className="btn-create">
        ＋ メモを書く
      </Link>

      <div className="list-controls">
        <select
          className="sort-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
        >
          <option value="new">新しい順</option>
          <option value="old">古い順</option>
          <option value="value">あとで役立つ順（高→低）</option>
        </select>
      </div>

      <div className="data-tools">
        <button
          type="button"
          className="btn-backup"
          onClick={() => setConfirmingBackup(true)}
          disabled={backing}
        >
          バックアップ
        </button>
        <button
          type="button"
          className="btn-backup"
          onClick={handleRestoreButtonClick}
          disabled={restoring}
        >
          復元
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={handleFileSelected}
        />
      </div>

      {confirmingBackup && (
        <div className="backup-confirm">
          <p className="backup-confirm-text">
            バックアップを実行しますか？
            <br />
            メモ・ユーザータグ・「あとで役立つ」評価など、CMSのデータをJSON形式のファイルとして保存します。
            <br />
            このファイルは、CMSに読み込んで元の状態に復元するためのデータです。
            <br />
            <br />
            メモはお使いの端末（ブラウザ）内にのみ保存されており、外部には送信されません。
            データを所有し管理するのはご自身です。ホーム画面からの削除やブラウザのデータ消去、
            端末環境の変更を行う前に、このバックアップ機能で記録を保存しておくと安心です。
            <br />
            <br />
            このメモは、この端末（ブラウザ）を使える人であれば閲覧できる状態にあります。
            共有のパソコンなどでご利用の場合はご注意ください。
          </p>
          <div className="backup-confirm-actions">
            <button
              type="button"
              className="btn-backup-confirm"
              onClick={handleBackup}
              disabled={backing}
            >
              {backing ? "バックアップ中…" : "実行する"}
            </button>
            <button
              type="button"
              className="btn-cancel"
              onClick={() => setConfirmingBackup(false)}
              disabled={backing}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {backupMessage && <p className="backup-message">{backupMessage}</p>}

      {restoreError && <p className="restore-error">{restoreError}</p>}

      {restorePreview && (
        <div className="backup-confirm">
          <p className="backup-confirm-text">
            バックアップ日時：{formatDate(restorePreview.backupExportedAt)}
            <br />
            バックアップに含まれるメモ：{restorePreview.backupCount}件
            {restorePreview.currentCount > 0 && (
              <>
                <br />
                現在のメモ：{restorePreview.currentCount}件
              </>
            )}
            <br />
            比較の結果：新しく追加されるメモ {restorePreview.toAdd}件、
            内容が変更されるメモ {restorePreview.toChange}件があります。
            <br />
            復元すると、上記のメモが追加・上書きされます（現在のメモが削除されることはありません）。
            復元しますか？
          </p>
          <div className="backup-confirm-actions">
            <button
              type="button"
              className="btn-backup-confirm"
              onClick={handleConfirmRestore}
              disabled={restoring}
            >
              {restoring ? "復元しています…" : "復元する"}
            </button>
            <button
              type="button"
              className="btn-cancel"
              onClick={handleCancelRestore}
              disabled={restoring}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {restoreMessage && <p className="backup-message">{restoreMessage}</p>}

      {loading && <p className="empty-state">読み込み中…</p>}

      {!loading && notes.length === 0 && (
        <div className="empty-state">
          まだ記録がありません。
          <br />
          <Link href="/inbox" className="btn-primary-small">
            最初のメモを書く
          </Link>
        </div>
      )}

      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          onTagClick={(tag) => router.push(`/search?q=${encodeURIComponent(tag)}`)}
          onDeleted={handleNoteDeleted}
        />
      ))}
    </div>
  );
}

function todayString() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "不明";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "不明";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d
    .getHours()
    .toString()
    .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
