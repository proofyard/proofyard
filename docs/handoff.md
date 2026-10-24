# Proofyard 引き継ぎメモ（2026-10-23）

## プロジェクト

Next.js App Router の React Server Components を、ブラウザも Next.js サーバーも起動せず、Bun（`bun test`）の中だけでテストするフレームワーク。

- 仕様書: `docs/spec.md`（v1.0）。**必ず最初に全文を読むこと**
- 現状: Phase 0〜7 が完了（Edge Runtime は Fail Closed）。Phase 8（性能）も完了（ほかのテストの方法とのベンチマークの比較を含む）。ライブラリは `src/`（公開 API は `src/index.ts`、パッケージの `exports` は `proofyard` と `proofyard/preload`）
- テスト: `bun run test`（`tests/unit`（Phase 7 の確認は `advanced.test.tsx`）、PoC 1〜6、`tests/src-app`（`src/app` と tsconfig の `paths` のアプリ）、`tests/ppr`（`cacheComponents` のアプリ）。165 件）

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

- `requestRoute(url, { method, headers, cookies, body })`: `next start` と同じルーター（router-server）に通し、標準の `Response` を返す。Proxy（`proxy.ts` / `middleware.ts`）、next.config の redirects / rewrites / headers、Route Handler、404（`not-found`）は Next.js 自身が処理する
- `renderRoute(url, { mode: "ssr" | "client", streaming, headers, cookies })`: ルートの HTML を、ブラウザと同じく届いた順に document に入れる（最初の塊で文書を作り、続きは body の末尾に足して script を実行。`document.readyState` と `DOMContentLoaded` / `load` も合わせる）。`streaming: true` はシェルの時点で返り、`waitForFallback()` / `waitForComplete()` で途中の状態を見る（仕様 6.3）。既定は `waitForComplete()` まで待つ（データを止めたまま既定で呼ぶと返らない）。リダイレクトはたどる（最大 20 回、他のオリジンは Fail Closed）
  - client: Next.js 本体のクライアント（`app-next.js`）で HTML をハイドレーションする。React は本番版（`act` がないので `findBy` / `waitFor` で待つ。エラーのメッセージは本番と同じく短縮形）
  - Server Actions、`revalidatePath`、`redirect()` は Next.js のルーター経由で動く（ブラウザの fetch とサーバー側の `http://localhost` への fetch はメモリ内のルーターへ）
  - `app.router`（仕様 18.6）: `push` / `replace` / `refresh` / `back` / `forward` / `prefetch`、`pathname` / `searchParams`。Next.js の `useRouter` と同じインスタンス（`window.next.router`）を呼び、新しい状態がコミットされるまで待つ（Next.js がコミットのたびに書く `history` の pushState / replaceState で分かる。`prefetch` は fetch が終わるまで）
  - Link のクリック、`useRouter()`、Layout / Template、loading.tsx、Parallel / Intercepting Routes、Suspense を伴う遷移は Next.js 本体のクライアントルーターがそのまま動く
  - `location` / `history` は DOM アダプターの自前の実装（turbo-dom のものは固定）。ページの再読み込み（`location.assign` など）は Fail Closed
  - `app.errors`: window に報告されたエラー（Next.js は Hydration Mismatch などを `reportError` で報告する。DOM アダプターの `reportError` はブラウザと同じく window に `error` イベントを送り、取り消されなければ console.error。Bun のものは捕まえられなかった例外になる）。`app.waitFor`: Testing Library の `waitFor`
  - Phase 7 で確認したもの（Next.js 本体の処理のまま動く）: Metadata（`title.template`、`generateMetadata`、`generateViewport`、`icon.svg`、`opengraph-image.tsx`（`next/og`）、`sitemap.ts` / `robots.ts`。metadata のファイルは next-app-loader の出力が `next-metadata-route-loader` / `next-metadata-image-loader` を import するので、それも Next.js のローダーで生成する（export 名は SWC の `getModuleNamedExports`）。生成コードに知らないローダーが残ったら起動時に Fail Closed）、遷移後の `document.title`。Next.js 16 は metadata を本文と別に流すので、遷移のコミットより後に変わる。ルーターの操作は React の作業が落ち着くまで待つので、戻った時点で変わっている）、`after()`（応答のあと。`flushAfter()` で待つ）、`next/dynamic`（`ssr: false`）と `import()`、Hydration Mismatch、`useDeferredValue` / `startTransition` の中の `router.push`。仕様 16.3: `.env` の環境変数（Next.js の `loadConfig` が読む）、`server-only`、`next/image`（`/_next/image` の最適化も）。
  - CSS（`src/next/css.ts`）: CSS Modules は Next.js の css-loader を、サーバー側と同じ設定（`exportOnlyLocals`。クラス名だけ）で全部の層に使う（クラス名は next build と同じ `page_title__NlRtp` の形）。普通の CSS は空のモジュール（スタイルは DOM に入れない。`<link rel="stylesheet">` も出ない）。Sass と、別のファイルからの `composes` は Fail Closed
  - `next/font`: SWC が書き換えた `next/font/*/target.css?{...}` の import を、起動時にアプリのソースから集めて Next.js の `next-font-loader` → css-loader で生成し、置き換える（rsc 層のネイティブ読み込みの変換は同期なので先に作る）。`next/font/google` は next build と同じく起動時に Google から取得する（ネットワークが必要。手元で一度だけ確認。恒久的なテストには入れていない）。フォントのファイルの配信と preload の `<link>` はない
  - StrictMode は Next.js の define（`__NEXT_STRICT_MODE_APP`）のまま。本番版の React なので二重の描画などは起きない
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
  - redirect() はルーターがないので Fail Closed（`renderRoute` では動く）
- `getInvalidatedTags()`: このテストで無効化されたキャッシュタグ
- `createTestContext({ cache: "isolated" })`（仕様 11.5 の提案 API）: `renderRoute` / `requestRoute` / `prerenderRoute` / `flushAfter` / `cache.getInvalidatedTags()` をまとめるだけ。キャッシュは作らなくてもテストごとに分離していて、同じテストのコンテキストは共有する。`"isolated"` 以外は Fail Closed
- `prerenderRoute(url)`（仕様 12 章、`cacheComponents` のとき）: ビルド時のプリレンダリングの静的シェル。`{ status, shell, postponed, dynamicBoundaries }`。Next.js 本体の静的シェルのデバッグ（`?__nextppronly=1`。`__NEXT_EXPERIMENTAL_STATIC_SHELL_DEBUGGING` は define で埋め込まれるので設定の読み込みの直後に立て、ルートの PPR は `experimentalTestProxy` で有効にする）で、`isBuildTimePrerendering` の描画をそのまま使う。`/dashboard`（`"use cache"`、`cookies()` / `connection()` の Suspense）のシェルの本文は本物の `next build`（webpack）の `.html` と同じだった。Suspense の外の `cookies()` は next build と同じエラーで reject。動的なルートはルートのパス（`/products/[id]`）でフォールバックのシェル（Next.js の `?__nextppronly=fallback`。本物の next build の `[id].html` と同じだった）。具体的な URL は `?__nextppronly=1` で、どのシェルにするかは next start と同じく Next.js が prerender-manifest（next build と同じもの）から選ぶ: `generateStaticParams` が返すものは params が分かった静的シェル（本物の `hello.html` と同じ）、返さないものはフォールバックのシェル（`/products/1`。本物の next start の `?__nextppronly=1` と同じ）か、フォールバックのシェルが空のルート（`BLOCKING_STATIC_RENDER`）ならその URL の prerender（`/posts/other`。本物の next start の応答の先頭のシェルと同じ。本物の next start の `?__nextppronly=1` はこのとき 500）。next build が空で書き出すフォールバックのシェル（`/posts/[slug]`。exportApp の `hasEmptyStaticShell`）は、本物の next start が next build の空の `.html` をキャッシュから返すので、同じく空のシェル＋デバッグ用の閉じタグを返す（Proofyard は build の .html をキャッシュに置かないので、描画すると空のシェルを許さずに失敗する）。注意: `loadStaticPaths` は next dev では別プロセスで動かすが、ここでは同じプロセス（`globalThis.__incrementalCache` は戻す）
- `renderRoute` の結果の `metadata`（仕様 16.1）: いまの `<head>` にある、Next.js が描画したもの（`title`、`description`、`get(name)`（`<meta name>` か `<meta property>`））。metadata を解決し直さない
- React の作業が落ち着くまで待つ（`waitForComplete()`、ルーターの操作）: 進行中の fetch に加え、React のスケジューラーに残っているタスクがなくなるまで（`src/client/route-react-dom-client.ts` が react-dom より先に `unstable_scheduleCallback` を包んで数える）。これがないと、metadata の Suspense のハイドレーションの前に返り、すぐ遷移すると最初の HTML の `<title>` などが head に残った
- `flushAfter()`（`renderRoute` の結果の `lifecycle.flushAfter()` も同じ）: `after()` と Proxy の `waitUntil` の処理が終わるまで待つ。Next.js の、プラットフォームが `waitUntil` を渡す入口（`Symbol.for("@next/request-context")`）で受け取っている（next start では Next.js 内部の `AwaiterOnce`。どちらも渡された Promise を待つだけ）
- 使い方: `bun test --preload proofyard/preload`（対象アプリは `PROOFYARD_NEXT_APP`、既定はカレントディレクトリ）

## Next.js モード（PoC 5・6）の仕組み

Next.js の動作を推測で再現せず、Next.js 本体の部品をそのまま呼ぶ。`src/next/preload.ts` と `layers.ts`。

- ルートとエントリ: `discoverRoutes` / `createPagesMapping` / `createEntrypoints`（`next build` と同じ）。各エントリのローダー（`next-app-loader`、`next-middleware-loader`）を webpack と同じオプション（クエリ文字列）で呼ぶ。知らないローダーと edge runtime は Fail Closed
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
  - SSR 層に入れる Client Component: Next.js 本体のものは rsc 層のビルドで、アプリのものは全ソースの `"use client"` を調べて集める。`node_modules` のものは、アプリの静的な import / require から `node_modules` を辿って集め（パッケージの奥のファイル、別のパッケージも）、ネイティブ読み込みでは `onLoad`（そのファイルだけの filter）で Client Reference に置き換える。`require(変数)` などの動的な読み込みは辿れない
  - アプリから使う Next.js 本体のモジュールは固定の一覧（`private-next-rsc-*` などのエイリアスと App Router の公開の入口）。一覧にない `next/*` はネイティブで読まれて define が効かない
- manifest: `next start` が読む `.next` の最小構成を一時ディレクトリに書く（routes-manifest は `loadCustomRoutes` + Intercepting Routes の rewrite（`generateInterceptionRoutesRewrites`）+ `generateRoutesManifest`、Proxy は `server/middleware.js` と functions-config-manifest の matcher、Server Actions は SWC の変換結果から server-reference-manifest）
- リクエスト: 本文はストリームで返す（ステータスとヘッダーは最初の書き込みの時点）。router-server の `initialize`（設定は `__NEXT_PRIVATE_STANDALONE_CONFIG` で渡す）の `requestHandler` をモックの req/res で呼ぶ。サーバーのエラーは `next start` と同じくログに出る
- 生成物は `/tmp/proofyard-next-<pid>` に置き、全テストの後（プリロードの `afterAll`）に消す。途中で終わったものは次の起動時に消す
- キャッシュ: グローバルな `beforeEach` で、`"use cache"` のハンドラーとタグの記録をテストごとに空にする
- 対象アプリは環境変数 `PROOFYARD_NEXT_APP` で指定する（未指定なら PoC 5 のフィクスチャ）

## 本物の Next.js との比較（仕様 24.1）

- `bun run compat`（`compat:next-app` / `compat:src-app` / `compat:ppr` / `compat:errors`（PoC 5 のフィクスチャ: `error.tsx`、`not-found.tsx`、Error Boundary なしの例外、`redirect()`））。`bun run test` には入れない（next build を含み、1 つで 1〜2 分）
- `tests/compatibility/reference.ts`: フィクスチャを JS に変えた写し（Next.js 同梱の SWC で型だけ消す。JSX は残す）を一時ディレクトリに作り、`next build --webpack` と `next start` で動かす。TypeScript のファイルがあると next build が TypeScript を自動でインストールするため。`node_modules` はパッケージごとのリンク（ディレクトリごとにリンクすると、インストールがプロジェクトの `node_modules` を書き換える）。Turbopack は外へのリンクを辿れないので webpack
- 比べるもの: ステータス、Location、ヘッダー、HTML（script・link・ビルドごとに変わるものを除き、後から流れた Suspense の中身を fallback と入れ替えた後）。`prerenderRoute` は `.next/server/app/*.html` と（動的な部分があると .html は閉じタグなし）
- RSC のペイロード（クライアントのナビゲーションの `RSC: 1` と `_rsc=`）は Flight の意味論で比べる（`comparableFlight`）: バイト列（行の番号、モジュールの id）ではなく、Next.js 同梱の React の Flight クライアント（本番版）でデコードし、Promise と lazy を待った値を比べる。Client Component は「モジュールのパス#export 名」にする（本物の id は webpack の数字なので `*_client-reference-manifest.js` でパスに戻す。読み込みの代わりに `__next_require__` を差し替える）。除くもの: ビルド ID（`b`）、静的な部分のバイト数（`a`、`l`。モジュールの id の長さで変わる）、Viewport / Metadata の key（リクエストの id）。JS ありのクライアントからの Server Action（`Next-Action` と `encodeReply` の本文）の応答も同じく比べる（Bun の `FormData` は `toJSON` を持ち、`JSON.stringify` が React の判定より先に普通のオブジェクトにするので、テストでは隠す）。ソフトナビゲーション（`Next-Router-State-Tree` で今の木を送り、共通のレイアウトから下だけが返る。`Next-Url` のインターセプトも）も比べる（Router State）。比べるのはリクエストのときに描くルートだけ（静的なルートは、next start が build のときの RSC（最初の HTML 用の形。`P`・`G`・`c` がある）を返す）。RSC のリクエストは両方とも `_rsc` がないと 307（`validateRSCRequestHeaders`）
- 揃えている違い（比べ方の都合）: JS に変えたことで変わる Server Action の id とメタデータの画像の `[contenthash]`
- **分かった違い**:
  - Bun の `Response.json()` は `content-type: application/json;charset=utf-8`（Node.js は `application/json`）。アプリのコードが Bun で動くため
  - next start は、静的なルート（`cacheComponents` でないアプリ）を build のときに描画した HTML で返し、PPR のルートは静的シェルの続き（resume）で返す。`requestRoute` は毎回ページ全体をリクエストのときに描画する（テストごとのデータやモックが効くように）。そのため、`useSearchParams()` の Suspense は next start では fallback（CSR に任せる）だが `requestRoute` では中身が入り、存在しない URL の 404（`_not-found`）は `<title>` の並びが違う
  - next build の prerender の結果（`server/prefetch-hints.json` と `prerender-manifest.json`）: 本物は next build が静的なページのプリレンダリング（exportApp）で作る。ルーターの木の prefetch hints（`h`。`PrefetchHint`）は `prefetchInlining` が既定で有効なので `cacheComponents` でないアプリにもある。Proofyard も起動のときに別のプロセスで同じことをする（`PROOFYARD_BUILD_OUTPUT` を付けて preload を動かし、Next.js の `exportApp` に build/index.ts と同じ exportPathMap（generateStaticParams の URL）を渡す。StaticWorker の代わりに `export/worker` の `exportPages` をそのプロセスで呼び、prerender できないページ（next build なら失敗する）は除く。Next.js の manifest のキャッシュはコンパイル済みのランタイムの中にあり、同じプロセスでは消せないため別のプロセス）。hints は結果の `metadata.prefetchHints` をページごとに最初のものだけ残す。prerender-manifest の `routes` / `dynamicRoutes` は `cacheComponents` のアプリのページだけ、build/index.ts と同じ作り方で next start が読む項目を作る（`prerenderManifestRoutes`。分類（routeType など）や experimentalBypassFor はアダプター向けなので作らない。Route Handler は入れない）。どちらも next build と同じ（`tests/compatibility/ppr.test.ts`、`next-app.test.ts`）。起動は数秒遅くなる（ビルドと並行）
  - prerender-manifest にあるページの静的な部分（next start はファイルから読む）は、テストの中でそのページが最初にリクエストされたときに作る（`warmBuildOutput`）: `/_tree` のセグメントの先読みのリクエストで Next.js 本体に静的な部分だけを prerender させ（動的な部分は再開しないので副作用はない）、`distDir/server/route-cache` に書かせ、メモリーの結果は消してファイルから読ませる（next start と同じく PPR のページはファイルの `.rsc` を読まないので、metadata-only の先読みは 404）。テストの後に捨てる（`resetCache`）。そのため Link の静的な先読み（`/_tree`、metadata-only）の応答も本物と同じ。静的な部分（`"use cache"` など）はテストごとに一度だけ動く
  - JS なしのフォームの送信（`$ACTION_ID_`、React の `decodeAction`）が 500 だった（比較で発見して修正）。React は Action のモジュールを `hasOwnProperty` で確かめてから読むので、Proofyard の Action のモジュール（Proxy）に `getOwnPropertyDescriptor` と `has` を足した
  - next build は Suspense の外の `useSearchParams()` をエラーにする（`requestRoute` ではエラーにならない。`prerenderRoute` は `cacheComponents` のアプリだけ）。フィクスチャの `/dashboard` はこのため Suspense で囲んだ

## 分かった注意点

- **`NODE_ENV`**: `bun test` では `"test"` になるが、Next.js は `"production"` か `"development"` の前提。define では production 扱いに揃える（揃えないと開発用と本番用のコードが混ざって壊れる）
- **`NODE_ENV` で開発版と本番版を選ぶモジュール**（`react-server-dom-webpack/client` など）は外部にせずバンドルする。外部にすると `NODE_ENV=test` で開発版になり、本番版の React と混ざって壊れる
- Bun の実行時プラグイン: `onResolve` は素の指定子に効かない（`build.module` を使う）。`onLoad` は必ず中身を返す必要があり、CJS を返すと `module.exports` が失われる（`node_modules` には使えない）。非同期の `onLoad` を経たモジュールは `require` できない
- Bun.build の CJS → ESM 変換や `export *` の再エクスポートでは、export を取りこぼすことがある（`import * as m` の ESM ラッパーで回避）
- **HTML に出ないもの**: Suspense の外の `notFound()` や例外では、HTML は空のエラー用シェルになり、`not-found.tsx` や `error.tsx` は RSC ペイロードからブラウザで描かれる（Next.js 本来の動作）。画面上の表示の検証には Next.js のクライアントルーターを DOM 上で動かす必要がある（Phase 5）
- **本物の `next build` を実行すると、TypeScript がない場合に pnpm で自動インストールされる**。`node_modules` をシンボリックリンクで共有していると、プロジェクトの `node_modules` が書き換わる
- `cacheLife` の期限切れは、本番のメモリキャッシュでは「その場で再実行」（古い値は返さない）。時間は `performance.now()` なので偽の時計で動かせない
- Bun の `expect(promise).rejects` / `.resolves` は、待つ間にイベントループを入れ子で回す。Next.js の fast-set-immediate（`runInSequentialTasks`）のタスクの順番の前提が崩れ、`Invariant: Cannot start capturing immediates again` になる。`prerenderRoute` などは `await p.catch((e) => e)` で受けてから調べる
- rsc 層の Flight クライアント（プリレンダリング、`"use cache"`）は Client Reference を rsc 層のものに戻す（`rscModuleMapping`。`proofyard-rsc-client:` の id で `registerClientReference`）
- ページのエントリの `export * from entry-base`（CJS）の名前は Bun.build の ESM の出力で消える。`__proofyardEntryBase` の名前空間でも出し、`server/app/*.js` で混ぜる（`ComponentMod.patchFetch` など。next build の ComponentMod と同じ名前）
- サードパーティの状態管理（zustand・jotai・Redux Toolkit）は追加の対応なしで動く（`tests/unit/state-libraries.test.tsx`）。TanStack Query も動く（Server Component の `prefetchQuery` → `dehydrate` → `HydrationBoundary` → クライアントの `useQuery`（取り直さない）、`useMutation` と `invalidateQueries` でブラウザから Route Handler を呼ぶ。`tests/unit/tanstack-query.test.tsx`）。モジュールのスコープのストアも、テストごとにクライアントのバンドルを読み直すので、前のテストの状態は残らない
- `useSyncExternalStore`（サーバーは `getServerSnapshot`、ハイドレーションの後にクライアントの値）と `"use client"` の中の `client-only` は動く（`advanced.test.tsx`）。間違った側の import は Next.js 同梱の SWC が next build と同じ文面のエラーにする: `"use client"` から `server-only` は起動（層のビルド）で失敗、Server Component から `client-only` はそのページが 500（本物は build エラー。`tests/unit/server-client-only.test.ts`）
- **`mock.module` の分離（仕様 19 章）**: Bun は差し替えを戻さない（`mock.restore()` も戻さず、次のテスト・次のファイルに残る）。プリロードで `mock.module` を包み、テストの中の差し替えはテストの後に、ファイルの直下の差し替えはファイルの後に戻す（ファイルの読み込み中に登録した `afterAll` はそのファイルの後に動く。プリロードの `afterAll` は全部のファイルの後に 1 回だけ）。戻すときは本物を `?proofyard-restore=N` で読み込み直す（差し替えるときに読むと、Bun は読み込みの失敗を覚えていて、`server-only` のような読めないモジュールを差し替えられなくなる。ESM は `require.cache` に入らないので読み込み済みかは分からない）。本物が読めなければ、使うとそのエラーになる値にする（Bun は差し替えのときに値を読むので getter では戻せない）。戻した後は別のインスタンスで、モジュールの状態は初期に戻る。`beforeAll` の中の差し替えは、全部のファイルの後まで残る（`tests/unit/mock.test.ts`、`mock-files.test.ts`）
- **依存として使う**: README の使い方（`bunfig.toml` の `preload = ["proofyard/preload"]`、アプリは `next` / `react` / `react-dom` だけ）を一時ディレクトリのアプリで確かめる（`tests/unit/consumer.test.ts`）。SWC が出力する `@swc/helpers/_/*` は、Next.js と同じく Next.js 自身の依存から解決する（`create-compiler-aliases.ts`。アプリに `@swc/helpers` がないと実行時に見つからなかった）
- `node_modules` は Read と Bash で読めない設定。Next.js のソースは `/tmp/nextjs-v16.4.2`（v16.4.2 の sparse clone）を読む。無ければ取り直す

## 未対応（Fail Closed にしているもの・まだのもの）

- 確かめていない版（仕様 24.2）: プリロードの最初で Next.js（16.4.2 だけ）と Bun（1.4.x）の版を確かめ、違えばエラー。React は Next.js 内蔵のものを使うので Next.js の版で決まる。`package.json` の `peerDependencies` も `next: 16.4.2`
- `node_modules` 内の `"use cache"` / `"use server"`: 対応。Next.js の webpack と同じく、アプリのソースと同じ SWC（`getLoaderSWCOptions` はパスで `node_modules` かを見る）で変換する。rsc 層はアプリから辿った `node_modules` のファイルを読み込むときに変換し（Server Actions の manifest にも入れる）、SSR 層・ブラウザ層は指示子のあるファイルだけ変換する（Client Component から import すると Server Reference）。`tests/fixtures/next-app` の `fake-actions`（フォームと Client Component から。本物の next start と同じ HTML・Flight・Server Action の応答）と `tests/ppr` の `fake-cached`（静的シェル、キャッシュの再利用）
- `node_modules` 内の CommonJS の `"use client"`: 対応。Next.js の `next-flight-loader` と同じく React の `createClientModuleProxy` を rsc 層のモジュールにする（Bun の実行時プラグインでは CommonJS の `module.exports` が失われるので、ESM で返す。名前付きの export は CommonJS の export 名を正規表現で拾い、default の import は webpack と同じく `__esModule` を見て `proxy.default`（名前が `""` の参照））。本物の next start と同じ HTML・Flight（`/third-party/cjs`）。`renderRSC` でも default の参照の名前は `""`
- 独自の `cacheHandlers`: エラーにしている
- `node_modules` 内の CommonJS の `"use server"` / `"use cache"`: エラーにしている（読み込んだときに失敗する）。本物の next build（webpack）でも Server Action にならない（SWC が `registerServerReference` を付けず、`exports.X` は普通の関数のまま。フォームに渡すとページの描画がエラーになる）ことを 2026-10 に確かめた
- rsc 層のネイティブ読み込みの `react-server` の条件: アプリから辿れる `node_modules` のパッケージのうち、`package.json` に `"react-server"` があるものは Bun の解決（`--conditions react-server`。別プロセス）で求め、元のファイルを読んだら react-server のファイルを読む（ESM だけ。CommonJS は Fail Closed）。テストのファイルから同じパッケージを読んでも react-server のファイルになる（`react` などの別名と同じ）。Bun の解決は `bun` の条件も使う（Next.js の webpack は使わない）
- サードパーティのパッケージが `next/*` を import する場合: 対応（rsc 層のネイティブ読み込みでも `build.module` でアプリと同じ Next.js のモジュールになる。`next/headers`・`notFound`・クライアントの `next/navigation` の hooks を `tests/unit/advanced.test.tsx` で確認）
- ビルド時のプリレンダリング: 静的シェル（動的なルートを含む）は `prerenderRoute` で見られる。`requestRoute` / `renderRoute` は毎回リクエスト時に描画（ISR の保存したページは返さない）
- `src/` ディレクトリ: 対応（Next.js の `findPagesDir`。Proxy も `src/proxy.ts`）。tsconfig の `paths`: 対応（Next.js の `loadJsConfig` で読み、import の解決は Bun の tsconfig 対応）
- `instrumentation.*`（Node.js）: 対応。next build と同じく `server/instrumentation.js` に置き、`register` と `onRequestError` は Next.js 本体が呼ぶ。注意: このファイルの読み込みで「モジュールが見つからない」エラーは Next.js 本体が無視する（ファイルなしと同じ扱い）
- `instrumentation-client.*`: 対応。Next.js の `next-instrumentation-client-loader` の出力（`instrumentationClientInject` とアプリのファイル）をブラウザのバンドルの `private-next-instrumentation-client` にする。`onRouterTransitionStart` も Next.js のルーターが呼ぶ
- Pages Router: 未対応（Fail Closed）
- `"use cache: private"` / `"use cache: remote"`: 対応（Next.js 本体のまま。private は静的シェルに入らずリクエストごと、remote は自前でホストする場合の既定どおり "use cache" と同じメモリのハンドラー。静的シェルは next build の `private.html` と同じ。`tests/ppr`）
- Edge Runtime: Fail Closed
- turbo-dom 0.5.6 のセレクターは、引用符の中のエスケープ（`meta[property="og\:title"]`）を解釈しない（`CSS.escape` した値で探すと見つからない）
- スクロール（`scroll` オプション、ハッシュへのスクロール）: turbo-dom にレイアウトがないので検証していない
- turbo-dom 0.5.6 の `<template>` は `content` がない（HTML の続きの塊は div で解析している）
- ブラウザ層は `__NEXT_TEST_MODE` を有効にしている（ハイドレーションの完了の通知のため）。そのため先読みのリクエストに `next-test-fetch-priority` ヘッダーが付く

## 次のタスク

仕様23章のロードマップに沿って、Phase 1 以降で PoC のコードをライブラリにする。

- **土台は Next.js モード**（Next.js 内蔵の React と本体の部品。アプリのコードはネイティブで読み込み、`mock.module` も効く）
- Phase 1 は完了（起動時のビルドは 1〜2 秒。実行をまたいだキャッシュは Phase 8 で）
- Phase 3 は完了: Server Actions（`useActionState`、`useFormStatus`、`useOptimistic`、`.bind()`、クロージャ、シリアライズ、例外、RSC Refresh）。`useActionState` などの Next.js のルーター経由の動き（redirect、revalidatePath で画面を更新）はルートの描画（Phase 4/5）で
- Phase 4 は完了: `renderRoute`（ハイドレーション、Error Boundary、notFound、redirect）、Route Handler、Proxy、next.config の redirects / rewrites / headers。Phase 5 は完了（ナビゲーションの hooks、Router Cache の既定の動き（戻る / 進むはキャッシュ、Link は dynamic を取り直す）、最初の HTML のストリーミング）。Phase 6（Cache Components / PPR）は完了（静的シェルは `prerenderRoute`。動的なルートを含む）
- Phase 2 は完了: `render()`（SSR / Client / Hydration、Context、イベント、Portal、Client Mode の Suspense（Server のデータ待ち、`use()`））。フォームと `useActionState` などは Server Actions と一緒に Phase 3
- 注意: DOM を入れた後は、ネイティブで読むサードパーティのライブラリ（SSR 層・rsc 層）にも `window` が見える（Next.js の SWC で変換するアプリのコードは置き換え済み）
- DOM アダプター（`src/dom/environment.ts`）: turbo-dom が上書きする Bun 本来のグローバルのうち、DOM に固有でないもの（タイマー、`queueMicrotask`、`fetch`、`URL`、`performance`、`atob`/`btoa` など）は Bun のままにする（サーバー側のコードも使う。turbo-dom 0.5.6 の `btoa` はバイナリで無限ループした）。`installDom` は 1 プロセスに 1 回（入れ直すと user-event が古い document を使い続ける）
- 後片付け（プリロードの `afterEach`）: フォーカスを外してから React のルートを外し、body を空にする（turbo-dom は取り除いた要素を activeElement に残す）
- テストの期限: Next.js モードのテストは `--timeout 20000`（マシンの負荷が高いと最初のリクエストなどが 5 秒を超える）。ブラウザ層のビルドはプリロードで待つ
- 速度（Phase 8）: `bun run bench:api` で 1 テストあたりの時間（テストの本体の中央値。1 回目は分ける）と、仕様 20.5 の内訳（Flight（`RSC: 1` の RSC のリクエスト）、DOM の初期化（1 プロセスに 1 回）、Server Action（クリックから画面の更新まで）、テストどうしの後片付け（テストの終わりから次のテストの始まりまで。プリロードの afterEach / beforeEach と bun test 自体））。2026-10-24 の測定（中央値）: `requestRoute` 約 30ms、RSC のリクエスト約 9ms、DOM の初期化約 23ms、`renderRoute` ssr 約 19ms、client 約 77ms、Server Action 約 59ms、後片付けは 0.2〜2ms（client と Server Action の後が長い）。それより前の測定: 2026-10 の測定（2 コアで他のビルドが動いている負荷の高い状態。値は大きく揺れる）: `requestRoute` 約 24ms、`renderRoute` ssr 約 80ms、client 約 200ms、client + 入力 + Server Action 約 1s（2026-10-23 にクライアントのバンドルを関数で包んで作り直すようにして、client 約 27ms、Server Action 約 70ms）。大規模なアプリ（`bun run bench:large`。101 ルート、Client Component 301、テスト 1,000 件を生成）は 2 コアの `--parallel --no-isolate` で 315 秒 → 71 秒（起動はプロセスごとに約 18 秒）。起動（プリロード）は数秒で、大半は next-app-loader（エントリの生成）と層のビルド。next-app-loader は webpack と同じく `_compilation` を共有してディレクトリの中身をキャッシュする（共有しないと 30 ルートで約 4 秒余計にかかっていた）。SWC の変換結果は、Next.js の版・設定・ファイル名・中身をキーに `PROOFYARD_CACHE_DIR`（既定は一時ディレクトリの `proofyard-cache`）に保存し、プロセスどうし・実行どうしで使い回す（Server Action の鍵も next build の `.rscinfo` と同じく保存して使い回す。SWC のプラグインを使うアプリは保存しない。SWC に渡す swcCacheDir（プラグインのキャッシュ。設定の cacheRoot になる）もキーに入るので、プロセスごとのディレクトリにしない。2026-10-23 まではプロセスごとで、使い回せていなかった。直して大規模なアプリの起動の CPU 時間がワーカー 2 つで約 28 秒 → 約 20 秒、1,000 件で 120 秒 → 104 秒）。`--parallel` のワーカーどうしは next build の prerender の子プロセスを 1 回だけ動かして結果を共有する（`BUN_TEST_WORKER_ID` と親のプロセス。大規模なアプリの CPU 時間 146 秒 → 126 秒）。層のビルド（rsc / ssr / browser / renderRoute のクライアント）も最初のワーカーが 1 回だけして、出力（親のプロセスごとの一時ディレクトリ）とビルドの副作用（rsc 層のバンドルで見つけた Client Reference）を他のワーカーに渡す（起動の CPU 時間がワーカー 1 つあたり約 6 秒減る）。それ以外の、実行をまたいだビルドのキャッシュは見送り（ビルドの副作用（Client Reference の記録など）も保存が要り、解決できなかった依存がインストールで解決できるようになる変化は入力のハッシュでは分からない。正確性を優先）
- ほかのテストの方法との比較（仕様 20.5）: `bun run bench:compare`（`tests/benchmarks/compare/`）。同じ内容のテスト（`/` を開き、async な Server Component が読んだデータを確かめ、Client Component のボタンを押して表示が変わるのを待つ）をツールごとに生成して測る。起動はテスト 1 件で、コールドはキャッシュ（bun のトランスパイル、`PROOFYARD_CACHE_DIR`、vite の依存の最適化、Playwright は `.next` を消して next build から）を消して 1 回、ウォームは 3 回の中央値。1 件あたりは (1,000 件 − 100 件) / 900。メモリはプロセスツリー全体の PSS のピーク（50ms ごと）と、起動したプロセス自身の最大 RSS の大きい方。各実行で合格の件数を確かめ、ログは `results/` に残す。2026-10-24 の測定（2 コア、メモリ 7GB）:

  | | コールド起動 | ウォーム起動 | 100 件 | 1,000 件 | 1 件あたり | メモリのピーク |
  |---|---|---|---|---|---|---|
  | Bun のテストだけ（描画しない。データの関数だけ） | 0.02s | 0.08s | 0.03s | 0.11s | 0.09ms | 30MB |
  | RTL + happy-dom（Client Component だけ） | 1.0s | 0.60s | 2.7s | 15.6s | 14ms | 127MB |
  | RTL + turbo-dom（Client Component だけ） | 0.51s | 0.29s | 2.2s | 13.0s | 12ms | 101MB |
  | Proofyard（`--parallel --no-isolate`、2 ワーカー） | 6.2s | 2.3s | 13.9s | 41.8s | 31ms | 486MB |
  | vitest-plugin-rsc 0.4.0-alpha.0（Vitest Browser Mode の Chromium、開発ビルド） | 32.9s | 16.8s | 48.1s | 341s | 325ms | 1,539MB |
  | Playwright（next start、2 ワーカー。コールドは next build を含む） | 30.6s | 5.2s | 72.0s | 615s | 604ms | 962MB |

  RTL と Bun のテストだけのものはサーバー・Flight・ルーティングを通らないので、確かめている範囲が狭い（RTL はページの代わりにデータを渡した ItemsView を描画する）。Proofyard は RTL より 1 件あたり約 2.6 倍遅く、vitest-plugin-rsc より約 10 倍、Playwright より約 19 倍速い。Bun のテストだけのものは短すぎて時間の順番がそろわない（誤差）。注意: (1) この環境は root がなく Chromium のシステムライブラリとフォントが無いので、apt でダウンロードだけして `~/.cache/proofyard-chromium-libs` に展開し、`LD_LIBRARY_PATH` と `FONTCONFIG_FILE` で渡している（`run.ts` は、そのディレクトリが無ければ普通に動く）。フォントが無いと文字の高さが 0 になり、vitest-plugin-rsc の `toBeVisible` が失敗した。(2) `site/` で next build をすると、TypeScript が見つからないので Next.js が pnpm で `site/` に typescript を入れ、`site/package.json` を作る。`site/package.json` があると vite が `site` をルートとみなしてリポジトリの `node_modules` を配信せず、vitest-plugin-rsc の setup の読み込みが失敗する（`.gitignore` 済み。できたら消す）。
- 並列（仕様 20.4）: `bun test --parallel`（プロセスを分ける）は動く。`--parallel` の既定（`--isolate`）はファイルごとにプリロードをやり直すので遅い。`--no-isolate` ならワーカーごとに 1 回（ファイルどうしでモジュールを共有する）。生成物（`/tmp/proofyard-next-<pid>`）はテストの後に消さず、次の実行の起動時に、終わったプロセスのものを消す（`afterAll` で消すと、`--no-isolate` では `afterAll` がファイルごとに動いて次のファイルが失敗し、`--watch` では読み込んだファイルの変更として再実行が止まらなかった。bun test は exit のイベントを出さない）。`bun test --watch` は変更なしで 1 回だけ動き、テストのファイルとアプリのファイル（Server Component が読むもの、Client Component）を変えると再実行する（`tests/unit/watch.test.ts`）。Bun はランタイムのプラグインの onLoad で読んだファイル（rsc 層のアプリのソース・スタイル）と、層のバンドル（Bun.build）にだけ入るファイルを監視しない（oven-sh/bun#5844）ので、プリロードがアプリのソースとスタイルをクエリ付きのパス（プラグインを通らない）でテキストとして読み込んで監視させる（`--watch` かどうかはプロセスから分からないので毎回。1,464 ファイルの大規模なアプリで約 0.16 秒）。起動の後に足したファイルは、import されるまで監視されない。同じプロセスで同時に動くテスト（`test.concurrent` / `--concurrent`）は、DOM とキャッシュの分離ができないので `beforeEach` で Fail Closed（`afterEach` は `beforeEach` が失敗しても動くので数は合う）
- メモリ（Phase 8）: `renderRoute` の Client Mode はテストごとに Next.js のクライアントを作り直す（バンドル全体を包んだ関数 `createRoute` を呼ぶ。ページの読み込みと同じく状態を分ける）。後片付けで、ページの読み込みから付いた window / document のイベントリスナーと `setInterval` を外す（ブラウザでページを離れたときと同じ）。外さないと前のテストのモジュールが残り続ける（以前は 1 テストあたり約 2.6MB 増え、60 テストでヒープが 45MB → 203MB。いまは 300 テストで 50MB 前後のまま）

## 守ること（仕様27章の要約）

- 実装済みのものと未実装のものを明確に分ける。予定の機能を実装済みとして扱わない
- React の内部処理を自前で再実装しない。たとえば `await Page()` での評価は禁止。公式の Renderer と Flight を使う
- 速くするために Flight を省略しない。`JSON.stringify` で代用しない
- Client Component をサーバー側で直接実行しない
- 未対応の機能はテストを通さず、明示的にエラーにする（Fail Closed）
- Next.js の動作を推測で再現しない。実際の Next.js と比べるテストで確かめる
- 正確さを速度より優先する
