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

対象のアプリは `PROOFYARD_NEXT_APP`（既定はカレントディレクトリ）。

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
| `renderRoute(url, { mode, streaming, headers, cookies })` | ルートの HTML を DOM に入れる。`mode: "client"`（既定）は Next.js 本体のクライアントでハイドレーションし、`app.router`・Link・Server Actions が動く |
| `prerenderRoute(url)` | `cacheComponents` のアプリの静的シェル（Partial Prerendering）。`next build` の `.html` と同じ |
| `renderRSC(element)` | Server Components を Flight 経由で描画した木を調べる（Client Component は実行しない） |
| `render(element, { mode, hydrate })` | コンポーネント単位の SSR / Client / ハイドレーション |
| `createTestContext()`、`getInvalidatedTags()`、`flushAfter()` | キャッシュの検査、`after()` の完了待ち |

DOM、React のルート、リクエストのコンテキスト、アプリのキャッシュ（`"use cache"`、タグ）、ルーターのキャッシュ、`mock.module` は、テストごとに分ける。同じプロセスで同時に動くテスト（`test.concurrent`）は分けられないので Fail Closed。並列にするなら `bun test --parallel`。

## 本物の Next.js との違い

- `requestRoute` / `renderRoute` は、毎回ページ全体をリクエストのときに描画する（`next start` は静的なルートを build のときの HTML で返す）。テストごとのデータやモックが効くようにするため
- `cacheComponents` のアプリで、Link の先読みは静的なものを試さず、リクエストのときの先読みになる（本物は next build で測った prefetch hints を使う。Proofyard は build のときのプリレンダリングをしない）
- アプリのコードは Bun で動く（例: `Response.json()` の `content-type` に `charset=utf-8` が付く）
- 未対応のもの（Pages Router、Edge Runtime、`node_modules` の CommonJS の `"use client"` / `"use server"` など）と、詳しい仕組みは [docs/handoff.md](docs/handoff.md)

## 開発

```sh
bun run test       # 全部のテスト
bun run compat     # 本物の next build / next start と比べる（HTML、RSC の Flight、Server Actions、エラー。遅い）
bun run bench:api  # 1 テストあたりの時間
```

仕様は [docs/spec.md](docs/spec.md)。
