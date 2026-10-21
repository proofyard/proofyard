# Proofyard 引き継ぎメモ（2026-10-20）

## プロジェクト

Next.js App Router の React Server Components を、ブラウザも Next.js サーバーも起動せず、Bun（`bun test`）の中だけでテストするフレームワーク。

- 仕様書: `docs/spec.md`（v1.0）。**必ず最初に全文を読むこと**
- 現状: Phase 0（PoC 1〜6）が完了し、Phase 1 を進行中。ライブラリは `src/`（公開 API は `src/index.ts`、パッケージの `exports` は `proofyard` と `proofyard/preload`）
- テスト: `bun run test`（`tests/unit` と PoC 1〜6。73 件）

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
- `renderRSC(element)`: RSC Mode。Flight を往復させた React ツリーを返す（シェルが揃った時点。待っている Suspense は fallback）
  - クエリ（毎回いまの状態を読む）: `getByText` / `queryByText` / `getAllByText` / `queryAllByText`、`findByText` / `findAllByText`（届くまで待つ）、`waitForComplete()`、`getClientReference` / `getAllClientReferences`（export 名か、import した Client Component で探す）、`text()`、`root`
  - Client Component は実行しない（デコード時に目印のモジュールに差し替える）。Server Function は `$$id` と `$$bound` を持つ目印になる（呼ぶとエラー）
  - 描画中の例外は、本番の Flight では digest だけになるので、onError の digest で対応付けてサーバー側の元のエラーを投げる
  - Next.js のリクエスト API（`cookies()` など）は、リクエストの外なので Next.js 自身のエラーになる
- `render(element, { mode: "ssr" | "client", hydrate })`: SSR Mode / Client Mode。クエリは Testing Library（ssr は結果のコンテナ、client は Testing Library と同じく `document.body` 全体。Portal も見つかる）、`user`（user-event）、`html`、`recoverableErrors`（Hydration Mismatch など）
  - ssr: Flight → SSR 層の React（`react-dom/static` の prerender）→ HTML → turbo-dom
  - client: Flight → ブラウザ層の React（`createRoot`、非同期の act）。`hydrate: true` は同じ Flight を SSR とブラウザに流して `hydrateRoot`
  - DOM（turbo-dom）は最初の `render()` で入れる（プリロードでは入れない）。後片付けはプリロードの `afterEach`
- Server Actions（Client Mode の `render()`）: Client Component から呼ぶと、引数を `encodeReply` → サーバーで `decodeReply` → 実行 → 戻り値と描画し直した Server Components を Flight で返して画面を更新する（RSC Refresh）。`result.actions.getCalls(nameOrAction)` で呼び出しを検査
  - Action の id → 関数は、SWC の変換結果が呼ぶ `registerServerReference` を記録して引く（`src/testing/actions.ts`）
  - Client Component から import した `"use server"` は、Next.js のルーターの `callServer`（`next/dist/client/app-call-server`）の代わりに `render()` のものを使う（`src/client/app-call-server.ts`。ルートの描画では本物のルーターを使う予定）
  - クロージャの値の暗号化の鍵は、プリロードで Next.js の manifests singleton に入れる
  - redirect() はルーターがないので Fail Closed
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
  - ブラウザ層（Client Mode）: Next.js のブラウザ用 React（`next/dist/compiled/react`）と Testing Library（`/pure`）を一緒にバンドルする（`src/client/runtime.ts`）。最初の `render()` でビルドし、Client Component は Flight で参照されたときに評価する
    - React は**開発版**（`act` は開発版にしかない）。Next.js の他の define は本番のまま
    - Flight クライアントの `__webpack_require__` / `__next_require__` は define で別の関数に向ける（SSR と混ざらないように）
    - Flight クライアントは本番版（Flight を作るサーバーと揃える）。開発版のクライアントは開発版のサーバーだけが送る情報（key の検証済みの印、エラーのスタック）を前提にしていて、偽の key の警告やエラーの復元の失敗が起きた
  - アプリのソースは SSR 層・ブラウザ層でも Next.js の SWC で変換する（`typeof window` の置き換えなど）
  - SSR 層に入れる Client Component: Next.js 本体のものは rsc 層のビルドで、アプリのものは全ソースの `"use client"` を調べて集める
  - アプリから使う Next.js 本体のモジュールは固定の一覧（`private-next-rsc-*` などのエイリアスと App Router の公開の入口）。一覧にない `next/*` はネイティブで読まれて define が効かない
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
- Phase 1 は完了（起動時のビルドは 1〜2 秒。実行をまたいだキャッシュは Phase 8 で）
- Phase 3 は完了: Server Actions（`useActionState`、`useFormStatus`、`useOptimistic`、`.bind()`、クロージャ、シリアライズ、例外、RSC Refresh）。`useActionState` などの Next.js のルーター経由の動き（redirect、revalidatePath で画面を更新）はルートの描画（Phase 4/5）で
- Phase 2 は完了: `render()`（SSR / Client / Hydration、Context、イベント、Portal、Client Mode の Suspense（Server のデータ待ち、`use()`））。フォームと `useActionState` などは Server Actions と一緒に Phase 3
- 注意: DOM を入れた後は、ネイティブで読むサードパーティのライブラリ（SSR 層・rsc 層）にも `window` が見える（Next.js の SWC で変換するアプリのコードは置き換え済み）
- DOM アダプター（`src/dom/environment.ts`）: turbo-dom が上書きする Bun 本来のグローバルのうち、DOM に固有でないもの（タイマー、`queueMicrotask`、`fetch`、`URL`、`performance`、`atob`/`btoa` など）は Bun のままにする（サーバー側のコードも使う。turbo-dom 0.5.6 の `btoa` はバイナリで無限ループした）。`installDom` は 1 プロセスに 1 回（入れ直すと user-event が古い document を使い続ける）
- 後片付け（プリロードの `afterEach`）: フォーカスを外してから React のルートを外し、body を空にする（turbo-dom は取り除いた要素を activeElement に残す）
- テストの期限: Next.js モードのテストは `--timeout 20000`（マシンの負荷が高いと最初のリクエストなどが 5 秒を超える）。ブラウザ層のビルドはプリロードで待つ

## 守ること（仕様27章の要約）

- 実装済みのものと未実装のものを明確に分ける。予定の機能を実装済みとして扱わない
- React の内部処理を自前で再実装しない。たとえば `await Page()` での評価は禁止。公式の Renderer と Flight を使う
- 速くするために Flight を省略しない。`JSON.stringify` で代用しない
- Client Component をサーバー側で直接実行しない
- 未対応の機能はテストを通さず、明示的にエラーにする（Fail Closed）
- Next.js の動作を推測で再現しない。実際の Next.js と比べるテストで確かめる
- 正確さを速度より優先する
