// ============================================================
// public/sw.js
// ------------------------------------------------------------
// PWA-v1.md 5章：Service Workerの目的は、オフライン環境でも
// CMSの基本機能（3章）を利用できるようにすることである。
//
// ナビゲーション戦略（2026-07-10改訂）：
// CMSは全画面がクライアント側でIndexedDBからデータを読むローカル
// ファースト構成であり、サーバーが返すHTMLシェル自体は再デプロイ
// されない限り実質的に変化しない（ユーザーごとの動的な内容を含まない）。
// そのため「常にネットワークを待ってから表示する」network-firstは
// このアプリには過剰であり、PWAとして起動した際の体感速度を大きく
// 損なっていた（特に保存後にリスト画面へ戻る場面）。
// 代わりにcache-first＋バックグラウンド更新（stale-while-revalidate）
// を採用する：キャッシュがあれば即座にそれを表示しつつ、裏側で最新版を
// 取得してキャッシュを更新する（次回表示時に反映される）。
// キャッシュが無い場合（初回訪問・未キャッシュURL）のみネットワークを
// 待つ。これによりオフライン確実性（3章）は維持したまま、オンライン時
// の体感速度も改善する。
//
// キャッシュ対象（5章）：HTML・CSS・JavaScript・アイコン・フォント・
// アプリ起動に必要な静的ファイル。
// キャッシュ対象外（5章）：ユーザーデータ・バックアップファイル・
// エクスポートしたJSON。これらはIndexedDBの読み書きやBlobダウンロードで
// 完結しており、そもそもfetch()を経由しないため、このファイルの
// fetchハンドラには現れない（除外のための特別な分岐は不要）。
//
// 更新方針（6章）：新しいバージョンのService Workerが見つかったら、
// ユーザーに通知せず自動的に有効化する（skipWaiting + clients.claim）。
// 古いバージョンのキャッシュはactivate時に削除する。
// ============================================================

const CACHE_VERSION = "cms-memory-core-v1";

// サーバーが応答しない場合（プロセス停止・電波不良等）、fetch()は
// ブラウザの接続タイムアウト（数十秒に及ぶこともある）まで解決しない
// ことがある。未キャッシュURLへの初回アクセス時に体感速度を保つため、
// 一定時間で打ち切ってキャッシュへフォールバックする。
const FETCH_TIMEOUT_MS = 3000;

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`fetch timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// 起動直後からオフラインで使えるよう、最低限のアプリシェルを事前キャッシュする。
// 詳細画面（/notes/[id]）はメモごとに異なるURLのため事前キャッシュの対象にできないが、
// 一度オンラインで開いたメモは、下のfetchハンドラがそのつどキャッシュするため
// 次回以降はオフラインでも開けるようになる。
const PRECACHE_URLS = [
  "/",
  "/inbox",
  "/search",
  "/manifest.webmanifest",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  console.log("[SW] install: start", CACHE_VERSION);
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(async (cache) => {
        console.log("[SW] install: cache opened", CACHE_VERSION);
        // cache.addAll()は1件でも失敗すると全体が失敗し、キャッシュに
        // 何も残らない（原因も分からない）。1件ずつ実行し、失敗しても
        // 他のURLは正常にキャッシュされるようにし、結果をログに残す。
        const results = await Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            fetch(url).then((response) => {
              if (!response.ok) {
                throw new Error(`status ${response.status}`);
              }
              return cache.put(url, response);
            })
          )
        );
        results.forEach((result, i) => {
          if (result.status === "fulfilled") {
            console.log("[SW] install: precached", PRECACHE_URLS[i]);
          } else {
            console.error(
              "[SW] install: failed to precache",
              PRECACHE_URLS[i],
              result.reason
            );
          }
        });
        console.log("[SW] install: done");
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  console.log("[SW] activate: start");
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        console.log("[SW] activate: existing cache keys", keys);
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => {
              console.log("[SW] activate: deleting old cache", key);
              return caches.delete(key);
            })
        );
      })
      .then(() => {
        console.log("[SW] activate: done, claiming clients");
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // GET以外・別オリジンへのリクエストは素通しする
  // （このアプリはPOST等のリクエストを行わないが、念のための防御）。
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // ネットワークから取得できたレスポンスをキャッシュへ書き込む共通処理。
  // エラー応答（4xx/5xx）はキャッシュに書き込まない。書き込んでしまうと
  // 一時的なサーバー障害時のエラーページがキャッシュに残り、次回オフライン
  // 表示や再訪問時に正常なページの代わりに返されてしまうため。
  function updateCache(request, response) {
    if (response.ok) {
      const copy = response.clone();
      caches
        .open(CACHE_VERSION)
        .then((cache) => cache.put(request, copy))
        .catch((err) => console.error("[SW] cache.put failed", request.url, err));
    }
    return response;
  }

  if (request.mode === "navigate") {
    // ページ遷移：cache-first + バックグラウンド更新（stale-while-revalidate）。
    // キャッシュがあれば即座にそれを返しつつ、裏側で最新版を取得して
    // キャッシュを更新する（体感速度を優先。次回表示時に反映される）。
    // キャッシュが無い場合（初回訪問等）のみネットワークを待ち、
    // それも失敗したら一覧画面（/）にフォールバックする（オフライン確実性）。
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetchWithTimeout(request, FETCH_TIMEOUT_MS)
          .then((response) => updateCache(request, response))
          .catch((err) => {
            console.warn(
              "[SW] fetch(navigate): network failed or timed out",
              request.url,
              err
            );
            return null;
          });

        if (cached) {
          // networkFetchは呼び出し済みでバックグラウンドで進行中（更新は
          // 次回表示時に反映される）。ここでは応答を待たずキャッシュを返す。
          return cached;
        }
        return networkFetch.then((response) => response || caches.match("/"));
      })
    );
    return;
  }

  // 静的アセット（JS/CSS/フォント/画像等）：Next.jsのビルド出力は
  // ハッシュ付きファイル名で内容が変わらないため、キャッシュを優先し、
  // 無ければネットワークから取得してキャッシュへ保存する
  // （ネットワークにもタイムアウトを設け、サーバー無応答時に長時間
  // 待たされないようにする）。
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetchWithTimeout(request, FETCH_TIMEOUT_MS).then((response) =>
        updateCache(request, response)
      );
    })
  );
});
