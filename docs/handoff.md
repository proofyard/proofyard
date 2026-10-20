# Proofyard 引き継ぎメモ（2026-10-20）

## プロジェクト

Next.js App Router の React Server Components を、ブラウザも Next.js サーバーも起動せず、Bun（`bun test`）の中だけでテストするフレームワーク。

- 仕様書: `docs/spec.md`（v1.0）。**必ず最初に全文を読むこと**
- 現状: Phase 0（PoC 1〜6）が完了し、Phase 1 を進行中。ライブラリは `src/`（公開 API は `src/index.ts`、パッケージの `exports` は `proofyard` と `proofyard/preload`）
- テスト: `bun run test`（`tests/unit` と PoC 1〜6。51 件）

## 決めたこと

- **名前は Proofyard**。「bun」「flight」「next」は名前に使わない（オーナーの希望、Next.js は商標）
- npm と GitHub の名前は**オーナーが自分のアカウントで確保する**。AI からは公開・Organization 作成をしない（確保済みかはオーナーに確認する）
- バージョンは厳密に固定: Bun 1.4.2、React 19.3.1、react-server-dom-turbopack 19.3.1、Next.js 16.4.2

## PoC の結果

| PoC | 結果 | 実装 |
|---|---|---|
| 1 RSC + Flight | 成功 | `tests/poc/poc1-rsc.test.tsx`。react-server-dom-turbopack |
| 2 Server/Client 分離 | 成功 | `tests/poc/poc2/plugin.ts`。サーバー側はネイティブ実行（`--conditions react-server`）、`?client` の付いた import をクライアントのグラフとしてバンドル。`mock.module` が効く |
| 3 Client（turbo-dom） | 成功 | `tests/poc/poc3`、`tests/poc/shared/dom.ts`。createRoot、hydrateRoot、Testing Library、user-event。happy-dom との比較は `bun run bench:dom` |
| 4 Server Actions | 成功 | `tests/poc/poc4`。HTTP なしで encodeReply/decodeReply、useActionState、useFormStatus、bind |
| 5 App Router | 成功 | `tests/poc/poc5`（下記「Next.js モード」） |
| 6 Cache Components | 成功 | `tests/poc/poc6`。同じテストを本物の `next build` + `next start` に流して結果が一致 |

## 公開 API（実装済み）

- `requestRoute(url, { method, headers, cookies })`: Next.js 本体のリクエスト処理に通し、標準の `Response` を返す
- `renderRSC(element)`: RSC Mode。Flight を往復させた React ツリーを返す。`getByText` / `queryByText` / `getAllByText` / `queryAllByText`、`getClientReference` / `getAllClientReferences`（export 名か、import した Client Component で探す）、`text()`、`root`
  - Client Component は実行しない（デコード時に目印のモジュールに差し替える）
  - 描画中の例外は、本番の Flight では digest だけになるので、サーバー側の元のエラーを投げる
  - Next.js のリクエスト API（`cookies()` など）は、リクエストの外なので Next.js 自身のエラーになる
- `getInvalidatedTags()`: このテストで無効化されたキャッシュタグ
- 使い方: `bun test --preload proofyard/preload`（対象アプリは `PROOFYARD_NEXT_APP`、既定はカレントディレクトリ）

## Next.js モード（PoC 5・6）の仕組み

Next.js の動作を推測で再現せず、Next.js 本体の部品をそのまま呼ぶ。`src/next/preload.ts` と `layers.ts`。

- ルートツリーとエントリ: `next-app-loader`（`next build` と同じ生成コード。`page` と `route` の両方）
- 設定: `loadConfig`。define: `getDefineEnv`。アプリのソースの変換: `getLoaderSWCOptions` + ネイティブの SWC
- ビルド: Next.js の層（rsc / ssr）を `Bun.build` で再現。React は Next.js 内蔵（vendored）のもの。エイリアスは `create-compiler-aliases.ts` と同じ
- アプリのコード（rsc 層）はバンドルせず**ネイティブで読み込む**（`mock.module` が効く）
  - `Bun.plugin` の `onLoad` で SWC 変換（同期）、`"use client"` は Client Reference に
  - `react` などは `build.module` で Next.js 内蔵の React に（CJS の `require` も置き換わる）
  - アプリが import する Next.js 本体のモジュール（`next/cache`、`next/navigation`、SWC が出力する `private-next-rsc-*`）はバンドル側に向ける（ネイティブで読むと define が効かない）
  - SSR 層に入れる Client Component は、事前にアプリも含めたバンドルを 1 回作って集める
- manifest: `next start` が読む `.next` の最小構成を一時ディレクトリに書く
- リクエスト: エントリの `handler(req, res)` をモックの req/res で呼ぶ（ステータス、リダイレクト、404 は Next.js 自身が決める）
- キャッシュ: グローバルな `beforeEach` で、`"use cache"` のハンドラーとタグの記録をテストごとに空にする
- 対象アプリは環境変数 `PROOFYARD_NEXT_APP` で指定する（未指定なら PoC 5 のフィクスチャ）

## 分かった注意点

- **`NODE_ENV`**: `bun test` では `"test"` になるが、Next.js は `"production"` か `"development"` の前提。define では production 扱いに揃える（揃えないと開発用と本番用のコードが混ざって壊れる）
- **`NODE_ENV` で開発版と本番版を選ぶモジュール**（`react-server-dom-webpack/client` など）は外部にせずバンドルする。外部にすると `NODE_ENV=test` で開発版になり、本番版の React と混ざって壊れる
- Bun の実行時プラグイン: `onResolve` は素の指定子に効かない（`build.module` を使う）。`onLoad` は必ず中身を返す必要があり、CJS を返すと `module.exports` が失われる（`node_modules` には使えない）。非同期の `onLoad` を経たモジュールは `require` できない
- Bun.build の CJS → ESM 変換や `export *` の再エクスポートでは、export を取りこぼすことがある（`import * as m` の ESM ラッパーで回避）
- **HTML に出ないもの**: Suspense の外の `notFound()` や例外では、HTML は空のエラー用シェルになり、`not-found.tsx` や `error.tsx` は RSC ペイロードからブラウザで描かれる（Next.js 本来の動作）。画面上の表示の検証には Next.js のクライアントルーターを DOM 上で動かす必要がある（Phase 5）
- **本物の `next build` を実行すると、TypeScript がない場合に pnpm で自動インストールされる**。`node_modules` をシンボリックリンクで共有していると、プロジェクトの `node_modules` が書き換わる
- `cacheLife` の期限切れは、本番のメモリキャッシュでは「その場で再実行」（古い値は返さない）。時間は `performance.now()` なので偽の時計で動かせない
- `node_modules` は Read と Bash で読めない設定。Next.js のソースは `/tmp/nextjs-v16.4.2`（v16.4.2 の sparse clone）を読む。無ければ取り直す

## 未対応（Fail Closed にしているもの・まだのもの）

- どのルートにも一致しない URL: エラーにしている（本物は 404 ページ）
- `node_modules` 内の `"use cache"` / `"use server"`、独自の `cacheHandlers`、`node_modules` 内のサードパーティの `"use client"`: エラーにしている
- サードパーティのパッケージがネイティブで `next/*` を import する場合は、バンドル側に向かない（未検証）
- ビルド時のプリレンダリング、PPR の静的シェル: 再現していない（毎回リクエスト時に描画）
- Next.js モードの Server Actions、`"use cache: private"` / `"use cache: remote"`、tsconfig の `paths`、middleware、metadata: 未検証

## 次のタスク

仕様23章のロードマップに沿って、Phase 1 以降で PoC のコードをライブラリにする。

- **土台は Next.js モード**（Next.js 内蔵の React と本体の部品。アプリのコードはネイティブで読み込み、`mock.module` も効く）
- Phase 1 の残り: Server Function References の検査、`renderRSC` の Suspense の途中状態（シェルだけ）の検査、テストのたびに作るビルドの高速化（初回のみにする）
- Phase 2: `render()`（SSR Mode / Client Mode。turbo-dom と Testing Library。PoC 3 の部品を Next.js モードに移す）

## 守ること（仕様27章の要約）

- 実装済みのものと未実装のものを明確に分ける。予定の機能を実装済みとして扱わない
- React の内部処理を自前で再実装しない。たとえば `await Page()` での評価は禁止。公式の Renderer と Flight を使う
- 速くするために Flight を省略しない。`JSON.stringify` で代用しない
- Client Component をサーバー側で直接実行しない
- 未対応の機能はテストを通さず、明示的にエラーにする（Fail Closed）
- Next.js の動作を推測で再現しない。実際の Next.js と比べるテストで確かめる
- 正確さを速度より優先する
