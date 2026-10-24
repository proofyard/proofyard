# Proofyard

Next.js App Router と React Server Components のアプリを、ブラウザも Next.js のサーバーも起動せずに `bun test` でテストする（まだ公開していない）。

- Next.js 本体の実装（ルーター、レンダリング、Flight、Server Actions、キャッシュ）をそのまま使い、React の内部を作り直さない
- DOM は turbo-dom。クエリと操作は Testing Library / user-event
- 対応していない機能は、普通の JavaScript として動かして通すのではなく、エラーにする（Fail Closed）

対応: Bun 1.4、Next.js 16.4.2（webpack と同じ層の分け方）、React は Next.js 内蔵のもの。ほかの版では起動時にエラーにする（Next.js の内部のモジュールを直接使うため）。

## 使い方

`bunfig.toml`:

```toml
[test]
preload = ["proofyard/preload"]
```

対象のアプリは `PROOFYARD_NEXT_APP`（既定はカレントディレクトリ）。SWC の変換結果などの保存先は `PROOFYARD_CACHE_DIR`（既定は一時ディレクトリの `proofyard-cache`。CI で実行をまたいで残すと起動が速くなる）。

```tsx
import { expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";

test("ユーザーを追加する", async () => {
  const app = await renderRoute("/users", { cookies: { session: "alice" } });
  await app.user.type(app.getByRole("textbox", { name: "new user" }), "Bob");
  await app.user.click(app.getByRole("button", { name: "Add" }));
  await app.findByText("Bob");

  await app.router.push("/users/Bob");
  expect(app.router.pathname).toBe("/users/Bob");
});

test("Route Handler と Proxy", async () => {
  const res = await requestRoute("/api/users/Alice", { cookies: { session: "Ann" } });
  expect(res.status).toBe(200);
});
```

`mock.module`（Bun 標準）でアプリのモジュールを差し替えられる。差し替えはテストの後（ファイルの直下ならファイルの後）に戻る。

## API

| API | 内容 |
| --- | --- |
| `requestRoute(url, { method, headers, cookies, body })` | `next start` と同じリクエスト処理（Proxy、next.config の redirects / rewrites / headers、Route Handler、Server Actions）を通し、`Response` を返す |
| `renderRoute(url, { mode, streaming, headers, cookies })` | ルートの HTML を DOM に入れる。`mode: "client"`（既定）は Next.js 本体のクライアントでハイドレーションし、`app.router`・Link・Server Actions が動く。同じテストでもう一度呼ぶと、ページを読み込み直したのと同じく前のページを捨てる。`app.actions.getCalls(nameOrAction)` でこのテストの Server Action の呼び出し、`app.cache.getInvalidatedTags()` で無効化したキャッシュタグ |
| `prerenderRoute(url)` | `cacheComponents` のアプリの静的シェル（Partial Prerendering）。`next build` の `.html` と同じ。動的なルートは、ルートのパス（`/products/[id]`）でフォールバックのシェル、具体的な URL で `next start` が最初に返すシェル |
| `renderRSC(element)` | Server Components を Flight 経由で描画した木を調べる（Client Component は実行しない） |
| `render(element, { mode, hydrate })` | コンポーネント単位の SSR / Client / ハイドレーション |
| `createTestContext()`、`getInvalidatedTags()`、`flushAfter()` | キャッシュの検査、`after()` の完了待ち |

DOM、React のルート、リクエストのコンテキスト、アプリのキャッシュ（`"use cache"`、タグ）、ルーターのキャッシュ、`mock.module` は、テストごとに分ける。同じプロセスで同時に動くテスト（`test.concurrent`）は分けられないので Fail Closed。並列にするなら `bun test --parallel`。

## 本物の Next.js との違い

- `requestRoute` / `renderRoute` は、毎回ページ全体をリクエストのときに描画する（`next start` は静的なルートを build のときの HTML で返す）。テストごとのデータやモックが効くようにするため
- `cacheComponents` のアプリの Link の静的な先読み（`/_tree` などのセグメントの先読み）は、本物は build のときに作ったデータを返す。Proofyard はテストの中でそのページを最初にリクエストしたときに build と同じもの（静的な部分だけの prerender）を作り、そのテストの間はそこから返す（テストの後に捨てる）。そのため、静的な部分（`"use cache"` など）はテストごとに一度だけ動く
- アプリのコードは Bun で動く（例: `Response.json()` の `content-type` に `charset=utf-8` が付く）
- 未対応のもの（Pages Router、Edge Runtime、`node_modules` の CommonJS の `"use server"` など）と、詳しい仕組みは [docs/handoff.md](docs/handoff.md)

## 開発

```sh
bun run test       # 全部のテスト
bun run compat     # 本物の next build / next start と比べる（HTML、RSC の Flight、Server Actions、エラー。遅い）
bun run bench:api  # 1 テストあたりの時間と内訳（Flight、DOM の初期化、Server Action、後片付け）
bun run bench:compare  # ほかのテストの方法（RTL、vitest-plugin-rsc、Playwright など）と比べる。結果は docs/handoff.md
```

仕様は [docs/spec.md](docs/spec.md)。
