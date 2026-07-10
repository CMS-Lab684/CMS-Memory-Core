// ============================================================
// lib/utils.ts
// ------------------------------------------------------------
// APIルート・ページ間で重複しがちな処理をここにまとめる。
// ============================================================

/** 未来価値（Future Value）の選択肢。ユーザーが手動で設定する */
export const FUTURE_VALUES = ["高", "中", "低", "未評価"] as const;
export type FutureValue = (typeof FUTURE_VALUES)[number];

export function isValidFutureValue(v: unknown): v is FutureValue {
  return typeof v === "string" && (FUTURE_VALUES as readonly string[]).includes(v);
}

/**
 * 検索用に文字列を正規化する。
 * 全角英数（ＣＭＳ）→半角（CMS）、大文字→小文字、のように
 * 表記ゆれを吸収し、"CMS" "cms" "ＣＭＳ" "ｃｍｓ" "Ｃｍｓ" を同一視できるようにする。
 */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/**
 * タグ入力欄の文字列を複数タグの配列に変換する。
 * スペース・カンマ・全角カンマのいずれの区切りでも複数タグとして扱う
 * （例："読書 学習 問題解決" → ["読書", "学習", "問題解決"]）。
 * 単語の頭に付けた"#"は除去する。
 */
export function parseTagsInput(input: string): string[] {
  return input
    .split(/[,\s、]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);
}

// ============================================================
// Ver1 入力制限仕様
// ------------------------------------------------------------
// UI（Inbox・詳細画面）とlib/localDb.tsの両方から同じ定数・関数を
// 使うことで、検証ロジックが二重実装によってズレないようにする。
// ============================================================

export const TITLE_MAX_LENGTH = 100;
export const BODY_MAX_LENGTH = 1_000_000;
export const TAG_MAX_LENGTH = 20;
export const TAG_MAX_COUNT = 20;

/** サロゲートペア文字（絵文字等）を1文字として数えるための文字数カウント。 */
function codePointLength(s: string): number {
  return Array.from(s).length;
}

/**
 * タイトルの文字数を検証する。呼び出し側で事前にtrim・必須チェック済みの
 * 値を渡すこと。上限を超える場合は例外を投げる。
 */
export function assertTitleLength(title: string): void {
  if (codePointLength(title) > TITLE_MAX_LENGTH) {
    throw new Error(`タイトルは${TITLE_MAX_LENGTH}文字以内で入力してください。`);
  }
}

/**
 * 本文の文字数を検証する（システム保護のための上限）。
 * 本文は前後の空白を保持したまま渡すこと（改行・レイアウトを維持するため）。
 */
export function assertBodyLength(body: string): void {
  if (body.length > BODY_MAX_LENGTH) {
    throw new Error("本文が長すぎます。");
  }
}

/**
 * タグ配列を正規化（trim・空タグ除去・重複除去）した上で、
 * 1タグの文字数・タグ数の上限を検証する。上限を超える場合は例外を投げる。
 */
export function normalizeAndValidateTags(rawTags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawTags) {
    const tag = String(raw).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }

  for (const tag of result) {
    if (codePointLength(tag) > TAG_MAX_LENGTH) {
      throw new Error(`タグは${TAG_MAX_LENGTH}文字以内で入力してください。`);
    }
  }
  if (result.length > TAG_MAX_COUNT) {
    throw new Error(`タグは${TAG_MAX_COUNT}個まで登録できます。`);
  }

  return result;
}
