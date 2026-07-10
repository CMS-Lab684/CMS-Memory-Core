// ============================================================
// lib/localDb.ts
// ------------------------------------------------------------
// ローカルファースト版のデータアクセス層（SPEC-v1.md準拠）。
// メモはブラウザのIndexedDBにのみ保存し、サーバーへは一切送信しない。
//
// この段階（Phase1 Step1）ではUI・ページは変更せず、
// 既存のサーバーAPI（/api/notes, /api/tags）と同等の操作を
// このモジュールの関数として提供することだけを目的とする。
//
// IndexedDBはブラウザにしか存在しないため、この中の関数は
// クライアントコンポーネントからのみ呼び出すこと（SSR中には呼ばない）。
// ============================================================

import {
  FutureValue,
  isValidFutureValue,
  normalizeText,
  assertTitleLength,
  assertBodyLength,
  normalizeAndValidateTags,
} from "./utils";

const DB_NAME = "cms-memory-core";
const DB_VERSION = 2;
const STORE_NAME = "notes";
const META_STORE_NAME = "meta";
const BACKUP_FORMAT_VERSION = 1;
const ONBOARDING_SEEN_KEY = "onboardingSeen";

export type SortOption = "new" | "old" | "value" | "updated";

// SPEC-v1.md 4.1のNoteデータモデル。
// ai フィールドは将来のAI機能拡張用の予約領域で、Phase1では一切読み書きしない。
export type Note = {
  id: string;
  title: string;
  body: string;
  userTags: string[];
  futureValue: FutureValue;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  ai?: {
    summary?: string;
    tags?: string[];
    type?: string[];
    titleSuggestion?: string;
    status?: string;
  };
};

export type CreateNoteInput = {
  title: string;
  body: string;
  userTags?: string[];
  futureValue?: FutureValue;
};

export type UpdateNoteInput = {
  userTags?: string[];
  futureValue?: FutureValue;
};

// SPEC-v1.md 6章のJSONバックアップ形式。
export type BackupFile = {
  formatVersion: number;
  app: string;
  exportedAt: string;
  noteCount: number;
  notes: Note[];
};

export type RestorePreview = {
  backupExportedAt: string | null;
  backupCount: number;
  currentCount: number;
  toAdd: number;
  toChange: number;
  unchanged: number;
  skipped: number;
};

export type RestoreResult = {
  added: number;
  changed: number;
  unchanged: number;
  skipped: number;
  totalAfter: number;
};

// ------------------------------------------------------------
// DB接続（シングルトン）
// ------------------------------------------------------------
// 呼び出しのたびに開き直さないよう、一度開いた接続のPromiseをキャッシュする。
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error(
        "IndexedDBを利用できません（ブラウザ環境でのみ動作します）。"
      )
    );
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // 初回アクセス時、またはDB_VERSIONを上げた時だけ呼ばれる。
      // 将来の拡張（storeやindexの追加）もここに追記する形で行い、
      // 既存storeの削除・作り直しは行わない（SPEC-v1.md 4.2）。
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("updatedAt", "updatedAt");
          store.createIndex("futureValue", "futureValue");
        }
        // v2で追加：初回利用案内の表示済みフラグなど、メモ本体とは別の
        // 単純な設定値を保存するための小さなキーバリューストア。
        if (!db.objectStoreNames.contains(META_STORE_NAME)) {
          db.createObjectStore(META_STORE_NAME, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

// ------------------------------------------------------------
// IndexedDBのコールバックAPIをPromise化する小さなヘルパー
// ------------------------------------------------------------
function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ------------------------------------------------------------
// 並び替え
// ------------------------------------------------------------
const FUTURE_VALUE_RANK: Record<FutureValue, number> = {
  高: 0,
  中: 1,
  低: 2,
  未評価: 3,
};

function sortNotes(notes: Note[], sort: SortOption): Note[] {
  const sorted = [...notes];
  switch (sort) {
    case "old":
      sorted.sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
      );
      break;
    case "value":
      // あとで役立つ順（高→中→低→未評価）。同じ評価内では新しい順。
      sorted.sort((a, b) => {
        const rankDiff =
          FUTURE_VALUE_RANK[a.futureValue] - FUTURE_VALUE_RANK[b.futureValue];
        if (rankDiff !== 0) return rankDiff;
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
      break;
    case "updated":
      sorted.sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      );
      break;
    case "new":
    default:
      sorted.sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
      );
  }
  return sorted;
}

// ------------------------------------------------------------
// 取得
// ------------------------------------------------------------

/** 全メモを取得する（並び替え指定可）。 */
export async function getAllNotes(sort: SortOption = "new"): Promise<Note[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const all = await promisifyRequest<Note[]>(tx.objectStore(STORE_NAME).getAll());
  return sortNotes(all, sort);
}

/**
 * キーワードでタイトル・本文・ユーザータグを検索する。
 * 全角/半角・大文字/小文字の表記ゆれはnormalizeTextで吸収する。
 * キーワードが空の場合は全件を返す（一覧と同じ挙動）。
 */
export async function searchNotes(
  query: string,
  sort: SortOption = "new"
): Promise<Note[]> {
  const all = await getAllNotes(sort);
  const trimmed = query.trim();
  if (!trimmed) return all;

  const needle = normalizeText(trimmed);
  return all.filter((note) => {
    const haystack = normalizeText(
      `${note.title} ${note.body} ${note.userTags.join(" ")}`
    );
    return haystack.includes(needle);
  });
}

/** 指定IDのメモを1件取得する。存在しない場合はundefined。 */
export async function getNote(id: string): Promise<Note | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  return promisifyRequest<Note | undefined>(tx.objectStore(STORE_NAME).get(id));
}

// ------------------------------------------------------------
// 作成
// ------------------------------------------------------------

/**
 * 新規メモを作成する。あとで役立つ評価は未指定・不正値の場合「未評価」になる。
 * Ver1入力制限仕様（タイトル100文字・本文100万文字・タグ20文字/20個）を検証する。
 * 上限を超える場合は例外を投げ、保存を行わない。
 */
export async function createNote(input: CreateNoteInput): Promise<Note> {
  const title = input.title?.trim();
  // 本文は前後の空白を保持する（改行・レイアウトを維持するため）。
  // 「空でないか」の判定にのみtrimした値を使う。
  const body = input.body ?? "";
  if (!title) throw new Error("タイトルは必須です");
  if (!body.trim()) throw new Error("本文は必須です");

  assertTitleLength(title);
  assertBodyLength(body);
  const userTags = normalizeAndValidateTags(input.userTags ?? []);

  const now = new Date().toISOString();
  const note: Note = {
    id: crypto.randomUUID(),
    title,
    body,
    userTags,
    futureValue: isValidFutureValue(input.futureValue)
      ? input.futureValue
      : "未評価",
    createdAt: now,
    updatedAt: now,
  };

  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).add(note);
  await promisifyTransaction(tx);

  return note;
}

// ------------------------------------------------------------
// 更新
// ------------------------------------------------------------

/**
 * ユーザータグ・あとで役立つ評価を更新する。
 * タイトル・本文はサーバー版と同様、作成後は編集対象にしない。
 */
export async function updateNote(
  id: string,
  patch: UpdateNoteInput
): Promise<Note> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  const existing = await promisifyRequest<Note | undefined>(store.get(id));
  if (!existing) {
    tx.abort();
    throw new Error("メモが見つかりません");
  }

  const updated: Note = {
    ...existing,
    userTags:
      patch.userTags !== undefined
        ? normalizeAndValidateTags(patch.userTags)
        : existing.userTags,
    futureValue: isValidFutureValue(patch.futureValue)
      ? patch.futureValue
      : existing.futureValue,
    updatedAt: new Date().toISOString(),
  };

  store.put(updated);
  await promisifyTransaction(tx);

  return updated;
}

// ------------------------------------------------------------
// 削除
// ------------------------------------------------------------

/** 指定IDのメモ1件だけを削除する。他のメモには一切影響しない。 */
export async function deleteNote(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  await promisifyTransaction(tx);
}

// ------------------------------------------------------------
// タグ履歴
// ------------------------------------------------------------

const TAG_HISTORY_LIMIT = 20;

/**
 * 最近更新されたメモから、重複のないタグ履歴を新しい順に集める。
 * 上限（既定20件）に達したら打ち切る。削除処理は不要で、
 * 新しく使われたタグが増えるほど古いタグは自然に一覧から外れる。
 */
export async function getTagHistory(
  limit: number = TAG_HISTORY_LIMIT
): Promise<string[]> {
  const notes = await getAllNotes("updated");
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const note of notes) {
    for (const tag of note.userTags) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      tags.push(tag);
      if (tags.length >= limit) return tags;
    }
  }
  return tags;
}

// ------------------------------------------------------------
// バックアップ（エクスポート）
// ------------------------------------------------------------

/** 全メモをSPEC-v1.md 6章のJSONバックアップ形式で書き出す。 */
export async function exportBackup(): Promise<BackupFile> {
  const notes = await getAllNotes("old");
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    app: DB_NAME,
    exportedAt: new Date().toISOString(),
    noteCount: notes.length,
    notes,
  };
}

// ------------------------------------------------------------
// 復元（インポート）
// ------------------------------------------------------------

type ParsedBackup = {
  legacy: boolean;
  exportedAt: string | null;
  rawNotes: Record<string, unknown>[];
};

/**
 * バックアップファイルの形式を判定し、共通の中間形式に変換する。
 * formatVersionフィールドが無い場合は、旧SQLite版が出力したバックアップ
 * （formatVersion 0とみなす。SPEC-v1.md 6.2）として扱う。
 * 対応していない形式の場合は例外を投げ、復元処理を安全に中止させる。
 */
function parseBackupPayload(payload: unknown): ParsedBackup {
  if (!payload || typeof payload !== "object") {
    throw new Error("バックアップファイルの形式が正しくありません");
  }
  const obj = payload as Record<string, unknown>;
  if (!Array.isArray(obj.notes)) {
    throw new Error("バックアップファイルの形式が正しくありません");
  }

  if (typeof obj.formatVersion !== "number") {
    // formatVersion未指定＝旧SQLite版が出力したバックアップ（snake_case）
    return {
      legacy: true,
      exportedAt: typeof obj.exported_at === "string" ? obj.exported_at : null,
      rawNotes: obj.notes as Record<string, unknown>[],
    };
  }

  if (obj.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `対応していないバックアップ形式です（formatVersion: ${obj.formatVersion}）。CMS Memory Coreを最新版に更新してから、もう一度お試しください。`
    );
  }
  if (obj.app !== DB_NAME) {
    throw new Error(
      "このファイルはCMS Memory Coreのバックアップファイルではありません"
    );
  }

  return {
    legacy: false,
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : null,
    rawNotes: obj.notes as Record<string, unknown>[],
  };
}

/**
 * 現行形式（camelCase）のメモを正規化する。
 * 既知フィールドは検証・既定値補完を行うが、それ以外の未知フィールド
 * （将来のai拡張等）は削除せずそのまま保持する（SPEC-v1.md 6.2）。
 */
function normalizeV1Note(raw: Record<string, unknown>): Note | null {
  if (
    typeof raw.id !== "string" ||
    typeof raw.title !== "string" ||
    typeof raw.body !== "string"
  ) {
    return null;
  }
  const now = new Date().toISOString();
  return {
    ...raw,
    id: raw.id,
    title: raw.title,
    body: raw.body,
    userTags: Array.isArray(raw.userTags) ? raw.userTags.map(String) : [],
    futureValue: isValidFutureValue(raw.futureValue) ? raw.futureValue : "未評価",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  } as Note;
}

/** 旧SQLite版（formatVersion 0、snake_case）のメモをNote形式に変換する。 */
function normalizeLegacyNote(raw: Record<string, unknown>): Note | null {
  if (
    typeof raw.id !== "string" ||
    typeof raw.title !== "string" ||
    typeof raw.body !== "string"
  ) {
    return null;
  }
  const now = new Date().toISOString();
  return {
    id: raw.id,
    title: raw.title,
    body: raw.body,
    userTags: Array.isArray(raw.user_tags)
      ? (raw.user_tags as unknown[]).map(String)
      : [],
    futureValue: isValidFutureValue(raw.future_value)
      ? (raw.future_value as FutureValue)
      : "未評価",
    createdAt: typeof raw.created_at === "string" ? raw.created_at : now,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : now,
  };
}

/**
 * 「内容が同一」の判定対象はtitle/body/userTags/futureValueの4項目のみ。
 * createdAt/updatedAtはタイムスタンプであり「内容」には含めない（SPEC-v1.md 6.3）。
 */
function isSameContent(a: Note, b: Note): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.futureValue === b.futureValue &&
    JSON.stringify(a.userTags) === JSON.stringify(b.userTags)
  );
}

function normalizeRawNote(raw: Record<string, unknown>, legacy: boolean): Note | null {
  return legacy ? normalizeLegacyNote(raw) : normalizeV1Note(raw);
}

/**
 * 復元の内容を比較し、件数のサマリーだけを返す（プレビュー）。
 * この時点ではIndexedDBへの書き込みは一切行わない。
 */
export async function previewRestore(payload: unknown): Promise<RestorePreview> {
  const parsed = parseBackupPayload(payload);
  const current = await getAllNotes();
  const currentById = new Map(current.map((n) => [n.id, n]));

  let toAdd = 0;
  let toChange = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const raw of parsed.rawNotes) {
    const note = normalizeRawNote(raw ?? {}, parsed.legacy);
    if (!note) {
      skipped++;
      continue;
    }
    const existing = currentById.get(note.id);
    if (!existing) {
      toAdd++;
    } else if (isSameContent(existing, note)) {
      unchanged++;
    } else {
      toChange++;
    }
  }

  return {
    backupExportedAt: parsed.exportedAt,
    backupCount: parsed.rawNotes.length,
    currentCount: current.length,
    toAdd,
    toChange,
    unchanged,
    skipped,
  };
}

/**
 * 復元を実際に実行する。追加・更新のみ行い、バックアップに含まれない
 * 既存メモを削除することは一切ない（SPEC-v1.md 5.8/6.3）。
 * 内容が異なる場合はバックアップの内容を正として無条件に上書きする
 * （updatedAtの新旧比較は行わない。単一デバイス運用・手動操作を前提とした
 * 意図的な単純化。SPEC-v1.md 6.3）。
 */
export async function commitRestore(payload: unknown): Promise<RestoreResult> {
  const parsed = parseBackupPayload(payload);

  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const current = await promisifyRequest<Note[]>(store.getAll());
  const currentById = new Map(current.map((n) => [n.id, n]));

  let added = 0;
  let changed = 0;
  let unchanged = 0;
  let skipped = 0;
  const restoredAt = new Date().toISOString();

  for (const raw of parsed.rawNotes) {
    const note = normalizeRawNote(raw ?? {}, parsed.legacy);
    if (!note) {
      skipped++;
      continue;
    }

    const existing = currentById.get(note.id);
    if (!existing) {
      store.put(note);
      added++;
      continue;
    }
    if (isSameContent(existing, note)) {
      unchanged++;
      continue;
    }
    store.put({ ...note, updatedAt: restoredAt });
    changed++;
  }

  await promisifyTransaction(tx);

  const totalAfter = (await getAllNotes()).length;

  return { added, changed, unchanged, skipped, totalAfter };
}

// ------------------------------------------------------------
// 初回利用案内（オンボーディング）
// ------------------------------------------------------------
// メモ本体とは無関係の単純な確認済みフラグのため、notesストアではなく
// meta ストアに保存する。サイトデータが削除されればこのフラグも
// 一緒に消えるため、その場合は初回扱いとして再表示される（想定通り）。

type MetaRecord = { key: string; value: boolean };

/** 初回利用案内を既に確認済みかどうかを返す。 */
export async function hasSeenOnboarding(): Promise<boolean> {
  const db = await openDb();
  const tx = db.transaction(META_STORE_NAME, "readonly");
  const record = await promisifyRequest<MetaRecord | undefined>(
    tx.objectStore(META_STORE_NAME).get(ONBOARDING_SEEN_KEY)
  );
  return record?.value === true;
}

/** 初回利用案内を確認済みとして記録する。 */
export async function markOnboardingSeen(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META_STORE_NAME, "readwrite");
  tx.objectStore(META_STORE_NAME).put({
    key: ONBOARDING_SEEN_KEY,
    value: true,
  } satisfies MetaRecord);
  await promisifyTransaction(tx);
}
