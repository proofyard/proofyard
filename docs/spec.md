# Proofyard
## Bun Native RSC Testing Framework 全体設計・技術仕様書 v1.0

**ステータス：設計段階／技術検証未実施**  
**対象：React 19以降、Next.js App Router、Bun**  
**開発言語：TypeScript**  
**DOM実装：turbo-dom**  
**想定ライセンス：MIT**

---

# 1. プロジェクト概要

## 1.1 目的

Next.jsのReact Server Components（RSC）を、**実ブラウザやNext.jsサーバーを起動せず、Bun上で高速かつ正確にテストできるフレームワーク**を開発する。

現在、Next.jsの非同期Server Componentsは一般的なユニットテスト環境では扱いにくく、E2Eテストに依存しやすい。

PlaywrightなどによるE2Eテストは、ブラウザの起動、Next.jsサーバーの起動、HTTP通信、ページ遷移などのオーバーヘッドが大きい。

本プロジェクトでは、これらの不要な処理を排除し、通常のBunユニットテストに近い開発体験を実現する。

ただし、高速化のためにReactやNext.jsの重要な動作を省略してはならない。

特に、以下を重視する。

- React Flightのシリアライズ制約
- Server ComponentとClient Componentの実行境界
- SuspenseとStreaming
- Server Actions
- Context Provider
- Next.js App Router
- Cache Components
- Hydration
- Client Router
- エラー伝播

最終的な目標は、**Next.js App Router向けのBunネイティブ・インプロセス統合テストフレームワーク**である。

## 1.2 コアコンセプト

> Test React Server Components and Next.js App Router applications with Bun, without launching a browser or Next.js server.

設計の基本原則は次のとおり。

1. Bunをテストランナーとして使用する。
2. React公式のレンダリング機構を再利用する。
3. React Flightのシリアライズを省略しない。
4. 実ブラウザを使用しない。
5. Next.jsサーバーを起動しない。
6. WebpackやTurbopackによるアプリケーション全体のバンドルを原則不要にする。
7. DOMにはturbo-domを採用する。
8. Next.js固有機能はAdapterとして分離する。
9. テスト間の状態を厳密に分離する。
10. 未対応の機能を不正確なモックで再現せず、明示的にエラーとする。

## 1.3 非目標

以下は本プロジェクトの直接的な開発対象としない。

- 独自テストランナーの開発
- 独自React Reconcilerの実装
- 独自DOMエンジンの開発
- ブラウザのレイアウトエンジンの再現
- CSSレイアウトのピクセル単位検証
- Visual Regression Testing
- 実ネットワーク環境の再現
- 実ブラウザ固有の挙動の完全再現
- Next.jsの本番ビルドの完全代替
- Edge Runtimeの完全再現

また、本フレームワークはPlaywrightなどのE2Eテストを完全に不要にすることを目的としない。

E2Eでしか検証できない領域は残る。

---

# 2. 技術スタック

## 2.1 採用技術

| 分類 | 技術 | 用途 |
|---|---|---|
| Runtime | Bun | JavaScript実行 |
| Test Runner | `bun:test` | テスト実行 |
| Language | TypeScript | フレームワーク実装 |
| React | React 19+ | コンポーネント実行 |
| RSC | React公式RSC Renderer | Server Componentsのレンダリング |
| Serialization | React Flight | RSC Payloadの生成・復元 |
| Client Renderer | `react-dom/client` | Client Componentの実行 |
| SSR | `react-dom/server` | HTML生成 |
| Testing | React Testing Library | DOMアサーション |
| DOM | turbo-dom | DOMエミュレーション |
| Next.js | App Router Adapter | Next.js統合 |

ReactのRSC実装には、次のパッケージを候補とする。

- `react-server-dom-webpack`
- `react-server-dom-turbopack`

これらを利用するだけでWebpackやTurbopackのビルドが起動するわけではない。

ただし、Client Referenceの生成やモジュールマッピングは別途必要である。

ReactとRSC関連パッケージには内部的なバージョン依存があるため、互換性のある組み合わせを厳密に管理すること。

## 2.2 turbo-domの採用

DOMエミュレーションには以下を使用する。

https://github.com/miaskiewicz/turbo-dom

採用理由：

- Rust製HTMLパーサーを使用
- JavaScriptとRust間の呼び出しを削減する設計
- DOM操作をJavaScript側で実行
- 遅延DOMノード生成
- HTML解析結果の再利用
- DOM検索結果のキャッシュ
- React Testing Libraryとの統合を想定

DOM全体をRustで実装する方針は採用しない。

ReactによるDOM操作は細かい呼び出しが大量に発生するため、すべてをFFI経由でRustに渡すと、かえって性能が低下する可能性がある。

ただし、turbo-domがBunとReact 19で正常に動作すること、およびhappy-domより高速であることは、実機で検証する必要がある。

**turbo-domは採用技術として固定するが、互換性上の制約が発覚した場合に備えて、内部のDOM Adapter境界は維持する。**

---

# 3. 全体アーキテクチャ

システムを以下の6つのRuntimeとTesting APIに分割する。

```text
                         bun test
                            │
                            ▼
                ┌──────────────────────┐
                │     Testing API      │
                │                      │
                │ renderRSC()          │
                │ render()             │
                │ renderRoute()        │
                │ requestRoute()       │
                │ prerenderRoute()     │
                │ createTestContext()  │
                └──────────┬───────────┘
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
   ┌────────────┐  ┌──────────────┐  ┌──────────────┐
   │ Module     │  │ Routing      │  │ Request      │
   │ Runtime    │  │ Runtime      │  │ Runtime      │
   │            │  │              │  │              │
   │ Compiler   │  │ App Router   │  │ Request      │
   │ Transform  │  │ Layouts      │  │ Context      │
   │ RSC Graph  │  │ Client Router│  │ Cookies      │
   │ Client     │  │ Router Cache │  │ Headers      │
   │ Graph      │  │ Navigation   │  │ Proxy        │
   └──────┬─────┘  └──────┬───────┘  │ Actions      │
          │               │          └──────┬───────┘
          └───────────────┼─────────────────┘
                          │
                          ▼
                ┌──────────────────────┐
                │  Rendering Runtime   │
                │                      │
                │ React RSC Renderer   │
                │ Flight Serializer    │
                │ Flight Decoder       │
                │ React DOM Server     │
                │ React DOM Client     │
                │ turbo-dom            │
                └──────────┬───────────┘
                           │
               ┌───────────┴────────────┐
               │                        │
               ▼                        ▼
       ┌──────────────┐         ┌──────────────┐
       │ Cache        │         │ Lifecycle    │
       │ Runtime      │         │ Runtime      │
       │              │         │              │
       │ React.cache  │         │ Suspense     │
       │ Cache        │         │ Streaming    │
       │ Components   │         │ Transitions  │
       │ Revalidation │         │ Hydration    │
       │ PPR          │         │ after()      │
       └──────────────┘         └──────────────┘
```

各Runtimeは責務を分離し、Next.js固有処理がReactコアの処理に直接入り込まないようにする。

---

# 4. 実行モード

テスト内容に応じて、3種類のレンダリングモードを提供する。

## 4.1 RSC Mode

最も軽量なモード。

```tsx
const result = await renderRSC(<Page />);

expect(result.getByText("Alice")).toBeDefined();
```

実行フロー：

```text
Server Components
       ↓
React RSC Renderer
       ↓
Flight Serialization
       ↓
Flight Deserialization
       ↓
Reactツリーの構造検証
```

対象：

- 同期Server Components
- 非同期Server Components
- ネストしたServer Components
- Props
- Suspense
- Flightシリアライズ
- Client References
- Server Function References
- エラー伝播

特徴：

- DOMを生成しない
- Client Componentsを実行しない
- React DOM Serverを起動しない
- 実ブラウザを必要としない

Client ComponentはClient Referenceとして扱う。

このモードのクエリはReact構造に対する検査であり、DOM Testing Libraryのクエリとは意味論が異なる。

## 4.2 SSR Mode

Client Componentsの初期レンダリングまで実行する。

```tsx
const result = await render(<Page />, {
  mode: "ssr",
});

expect(result.getByText("Alice")).toBeDefined();
```

実行フロー：

```text
RSC Renderer
      ↓
Flight
      ↓
Flight Decoder
      ↓
React DOM Server
      ↓
HTML
      ↓
Assertions
```

対応：

- Server Components
- Client Componentsの初期HTML
- Context Provider
- `useState` の初期状態
- Nested Layouts
- Streaming SSR
- Suspense Fallback
- HTML構造の検証

`useEffect` は実行しない。

HTMLをDOMとして検査する場合にはturbo-domを使用する。

単純なHTML文字列検証ではDOM初期化を省略できる。

## 4.3 Client Mode

ReactのClient Runtimeまで実行する。

```tsx
const result = await render(<Page />, {
  mode: "client",
});

await result.findByText("Ready");
```

実行フロー：

```text
RSC Renderer
      ↓
Flight Serialization
      ↓
Flight Deserialization
      ↓
React DOM Client
      ↓
turbo-dom
      ↓
React Testing Library
      ↓
Assertions
```

対応：

- `useEffect`
- `useLayoutEffect`
- `useState`
- `useReducer`
- `useContext`
- `useTransition`
- `useOptimistic`
- `useActionState`
- `useFormStatus`
- DOMイベント
- Context Provider
- Client Suspense
- Portals
- 状態更新

Client Modeでは、さらに以下の描画方式を区別する。

```typescript
type ClientRenderStrategy =
  | "mount"
  | "hydrate";
```

`mount` は`createRoot()`を使用する。

`hydrate` はSSR HTMLを生成した後、`hydrateRoot()`を使用する。

Hydration Mismatchを検証する場合は後者が必要となる。

---

# 5. Module Runtime

## 5.1 責務

Module Runtimeは以下を担当する。

- TypeScript/TSXの読み込み
- Server/Clientモジュール境界の識別
- `"use client"` の処理
- `"use server"` の処理
- `"use cache"` の処理
- モジュールグラフの構築
- Client Referenceの登録
- Server Function Referenceの登録
- モジュールモック
- パスエイリアス解決

## 5.2 Server/Clientモジュールグラフ

Server ComponentとClient Componentでは異なるモジュール解決条件を使用する。

そのため、単一のモジュールグラフとして処理してはならない。

```text
Application Source
        │
        ▼
 Module Analysis
        │
        ├── Server Graph
        │      ├── Server Components
        │      ├── Server Functions
        │      └── Server Dependencies
        │
        └── Client Graph
               ├── Client Components
               ├── Client Dependencies
               └── Browser Dependencies
```

サーバー側でClient Componentをimportした場合、Client Componentを直接実行せずClient Referenceを返す。

クライアント側では、Client Referenceを実際のモジュール実装に解決する。

`react-server` 条件の適用、Bunのモジュールキャッシュ、同じモジュールの異なる実行条件での読み込みは重要な検証項目である。

必要であれば、プロセス、Worker、モジュールローダーなどによる実行環境の分離を検討する。

**BunのプラグインAPIだけで必要なモジュール変換と解決が可能かは未検証であり、最優先の技術検証対象とする。**

## 5.3 Client Reference

Server ComponentからClient Componentを参照する場合、Flightが認識できるClient Referenceを生成する。

必要な情報：

- Module ID
- Export Name
- Client Module Mapping
- Reference Metadata

Referenceの形式はReact公式実装との互換性を優先する。

独自プロトコルは定義しない。

## 5.4 Server Functions

以下の両方に対応する。

**モジュールレベル**

```tsx
"use server";

export async function createUser(data: FormData) {
  // ...
}
```

**関数レベル**

```tsx
export default function Page() {
  async function submit() {
    "use server";
    // ...
  }

  return <form action={submit} />;
}
```

関数レベルの`"use server"`はクロージャ変換が必要になる。

単なるディレクティブ検出だけでは不十分である。

Next.jsコンパイラとの互換性を検証すること。

---

# 6. Rendering Runtime

## 6.1 React公式レンダラーを使用

Reactコンポーネントを独自の再帰処理で評価してはならない。

例えば、

```tsx
const element = await Page();
```

という方法は正式なRSCレンダリングの代替にならない。

Suspense、Server/Client境界、React内部の非同期処理、Flightなどを正確に再現できないためである。

React公式のRSC Rendererを使用する。

## 6.2 Flightは必須

すべてのRSCテストはFlightのシリアライズを経由する。

```text
RSC Render
    ↓
Flight Encode
    ↓
Serialization Validation
    ↓
Flight Decode
    ↓
Assertions
```

これによって以下を検証する。

- Client ComponentへのProps
- シリアライズ可能な値
- シリアライズ不可能な値
- Client References
- Server Function References
- 非同期値
- エラー情報
- Suspense境界

FlightはJSONではないため、`JSON.stringify()`で代替しない。

また、Flightのシリアライズエラーがストリーム上で通知される場合もあるため、完了・失敗の判定にはレンダラーのエラー通知も使用する。

## 6.3 Streaming

非同期処理の完了結果だけでなく、途中状態を検証できるようにする。

```tsx
const result = await renderRoute("/users", {
  mode: "client",
  streaming: true,
});

await result.waitForFallback();

expect(result.getByText("Loading..."))
  .toBeDefined();

await result.waitForComplete();

expect(result.getByText("Alice"))
  .toBeDefined();
```

ただし、RSCストリームの進行とDOMの表示状態は同一ではない。

内部的に以下を区別する。

- RSC Streaming
- SSR Streaming
- Client Commit
- Suspense Resolution

## 6.4 非同期制御

テストで非同期処理を意図的に停止・再開できる仕組みを提供する。

```tsx
const task = deferred<User>();

mockGetUser.mockImplementation(() => task.promise);

const result = await renderRoute("/users", {
  mode: "client",
});

expect(result.getByText("Loading..."))
  .toBeDefined();

task.resolve({
  id: "1",
  name: "Alice",
});

await result.findByText("Alice");
```

これは提案APIである。

非同期処理をすべて即時解決してしまう実装は避ける。

---

# 7. Server ComponentとClient Componentの混在

次のような構造に対応する。

```text
Server Component
    │
    └── Client Component
            │
            └── Server Component
                    │
                    └── Client Component
```

具体例：

```tsx
export default function Page() {
  return (
    <ClientProvider>
      <ServerContent />
    </ClientProvider>
  );
}
```

```tsx
"use client";

export function ClientProvider({ children }) {
  return (
    <ThemeProvider>
      {children}
    </ThemeProvider>
  );
}
```

```tsx
export default async function ServerContent() {
  const user = await getUser();

  return <ClientCard user={user} />;
}
```

この場合、ServerContentはClientProviderによって直接実行されるわけではない。

ServerContentはサーバー側で評価され、レンダリング結果がClientProviderのchildrenとして渡される。

この実行境界を維持すること。

また、Client Providerで囲まれたServer Componentが、Client Contextを直接参照できるようにしてはならない。

---

# 8. Server Actions Runtime

## 8.1 対応範囲

以下に対応する。

- `"use server"`
- Server Function Reference
- Server Action ID
- ClientからのAction呼び出し
- 引数のシリアライズ
- 戻り値のシリアライズ
- FormData
- `.bind()` による引数束縛
- クロージャ
- `useActionState`
- `useFormStatus`
- `useOptimistic`
- Redirect
- キャッシュ無効化
- RSC再レンダリング
- Client UI更新

## 8.2 実行フロー

```text
Client Component
       │
       ▼
User Interaction
       │
       ▼
Server Action Proxy
       │
       ├── Serialize Arguments
       ├── Resolve Action ID
       └── Create Action Context
                    │
                    ▼
              Server Runtime
                    │
                    ├── Execute Action
                    ├── Update Data
                    ├── Update Cookies
                    ├── Revalidate Cache
                    └── Redirect
                    │
                    ▼
              Action Response
                    │
                    ├── Deserialize Result
                    ├── Refresh RSC
                    └── Update Client UI
```

HTTPサーバーは起動せず、メモリ内でActionを実行する。

ただし、引数・戻り値のシリアライズは省略しない。

HTTPのOrigin検証、CSRF保護、実際のネットワーク通信などは別のテスト対象とする。

## 8.3 Action Request Context

通常のRSCレンダリングとServer Actionでは実行コンテキストを分離する。

```typescript
type ExecutionContext =
  | "rsc-render"
  | "server-action"
  | "route-handler"
  | "prerender";
```

実際の内部設計では、単一enumだけでなく独立したコンテキスト情報を保持する。

Server Actionから利用できるNext.js APIは、その実行コンテキストに従って制御する。

## 8.4 テスト例

```tsx
test("ユーザーを作成できる", async () => {
  const app = await renderRoute("/users/new", {
    mode: "client",
  });

  await app.user.type(
    app.getByRole("textbox"),
    "Alice",
  );

  await app.user.click(
    app.getByRole("button", { name: "Create" }),
  );

  await app.findByText("Created");

  expect(
    app.actions.getCalls("createUser"),
  ).toHaveLength(1);
});
```

APIは提案段階である。

---

# 9. Next.js App Router Runtime

## 9.1 Route Resolution

Next.js App Routerのディレクトリ構造を解決する。

対応対象：

- `page.tsx`
- `layout.tsx`
- `template.tsx`
- `loading.tsx`
- `error.tsx`
- `global-error.tsx`
- `not-found.tsx`
- `default.tsx`
- Route Groups
- Dynamic Routes
- Catch-all Routes
- Optional Catch-all Routes
- Parallel Routes
- Intercepting Routes

例えば、

```text
app/
├── layout.tsx
└── dashboard/
    ├── layout.tsx
    ├── loading.tsx
    └── users/
        └── [id]/
            └── page.tsx
```

に対し、

```tsx
await renderRoute("/dashboard/users/123");
```

で必要なPage、Layout、Providerを組み立てる。

## 9.2 LayoutとTemplate

LayoutとTemplateは異なるライフサイクルを持つ。

Layoutはナビゲーション間で再利用される場合がある。

Templateは対象セグメントの遷移に伴って再生成され、Client StateやEffectの再初期化に影響する。

単純にReact要素を組み立てるだけではなく、Navigation Stateを含めて管理する。

## 9.3 Client Router

以下をサポートする。

- `router.push()`
- `router.replace()`
- `router.refresh()`
- `router.back()`
- `router.forward()`
- `router.prefetch()`
- `<Link>`
- `usePathname()`
- `useSearchParams()`
- `useParams()`
- `useSelectedLayoutSegment()`
- `useSelectedLayoutSegments()`

Client Routerは、単なるURLの変更として実装しない。

以下の状態を管理する。

- Router State
- Segment Tree
- Router Cache
- Layout State
- Navigation History
- Pending Navigation
- Prefetch State

重要なテスト対象：

- Layoutの再利用
- Provider状態の維持
- Client Stateの維持
- `router.refresh()` 後のRSC更新
- Suspenseを伴う遷移
- Parallel Routes
- Intercepting Routes

## 9.4 Parallel Routes

複数スロットの表示状態を管理する。

ソフトナビゲーションと直接アクセスで異なるレンダリング結果になる場合を検証する。

## 9.5 Intercepting Routes

同じURLでも遷移元によって異なるUIを表示できることを検証する。

例：

- `/feed`から`/photo/123`へ遷移するとモーダル
- `/photo/123`への直接アクセスでは通常ページ

Navigation Stateを保持する必要がある。

---

# 10. Next.js Request Runtime

## 10.1 対応API

以下を対象とする。

```typescript
cookies()
headers()
draftMode()

redirect()
permanentRedirect()
notFound()
forbidden()
unauthorized()
```

その他、Next.jsバージョンに応じたリクエスト関連APIに対応する。

## 10.2 Request Context

リクエスト単位で以下を保持する。

```typescript
interface TestRequestContext {
  url: URL;
  method: string;
  headers: Headers;
  cookies: Map<string, string>;
  params: Record<string, string | string[]>;
  searchParams: URLSearchParams;
}
```

これは概念的なインターフェースであり、実際にはNext.jsの非同期Request APIや内部コンテキストとの互換性を考慮する。

Request Contextはテスト間で共有しない。

## 10.3 Proxy

Next.js 16以降の`proxy.ts`を対象とする。

対象：

- Matcher
- Redirect
- Rewrite
- Request Headers
- Response Cookies
- 認証処理
- Route Resolutionとの連携

Proxyを通すテストと、Pageのみをテストするモードは区別する。

## 10.4 Route Handlers

`app/api/**/route.ts`をサポートする。

```tsx
const response = await requestRoute("/api/users", {
  method: "POST",
  body: JSON.stringify({
    name: "Alice",
  }),
});

expect(response.status).toBe(201);
```

対応：

- GET
- POST
- PUT
- PATCH
- DELETE
- OPTIONS
- HEAD
- Request / Response
- FormData
- Streaming Response
- Cookies
- Headers
- Dynamic Params

可能な限りWeb標準のRequest/Responseを使用する。

---

# 11. Cache Runtime

## 11.1 対応するキャッシュ

以下を区別する。

1. Reactの`cache()`
2. Next.js Cache Components
3. Next.js Client Router Cache
4. フレームワーク内部の高速化キャッシュ

この4種類を混同してはならない。

## 11.2 React.cache()

Reactの`cache()`はリクエスト単位のメモ化として扱う。

同一リクエスト内では結果を再利用する。

独立したリクエスト間では、適切にキャッシュを分離する。

## 11.3 Cache Components

対応対象：

```typescript
"use cache"
"use cache: private"
"use cache: remote"

cacheLife()
cacheTag()

revalidatePath()
revalidateTag()
updateTag()
```

Cache ComponentsはNext.jsのコンパイラ変換に依存する。

Bunの標準TSXローダーで`"use cache"`をそのまま実行しても、本番のキャッシュ処理は再現されない。

そのため、Next.jsコンパイラとの互換性が必要である。

コンパイル処理を正しく再現できない場合、Cache Components対応を有効と宣言しないこと。

## 11.4 キャッシュスコープ

```text
Shared Immutable Cache
    ├── Module Transform Cache
    └── HTML Parse Cache

Test Context
    ├── Cache Components
    ├── Cache Tags
    └── Cache Lifetime

Request Context
    └── React.cache()

Render Context
    ├── DOM State
    ├── React Root
    └── Provider State

Client Session
    └── Router Cache
```

基本原則：

- 不変な変換結果は再利用してよい。
- アプリケーションキャッシュはテスト間で分離する。
- 同一テスト内ではCache Componentsの共有を許可する。
- React.cacheはリクエストスコープを維持する。
- DOM変更をテスト間で共有しない。
- Router CacheはClient Sessionごとに管理する。

## 11.5 キャッシュ検証API

```tsx
test("キャッシュを再利用する", async () => {
  const ctx = createTestContext({
    cache: "isolated",
  });

  await ctx.renderRoute("/users");
  await ctx.renderRoute("/users");

  expect(getUsers).toHaveBeenCalledTimes(1);
});
```

キャッシュの無効化についても検証APIを提供する。

```tsx
expect(
  ctx.cache.getInvalidatedTags(),
).toContain("users");
```

これらは提案APIである。

---

# 12. Partial Prerendering

Cache ComponentsとPPRの統合を対象とする。

重要なのは、通常のRSCレンダリングとPrerenderを区別することである。

```text
Prerender Phase
      │
      ├── Static Shell
      │
      └── Deferred Boundaries
                    │
                    ▼
             Request Phase
                    │
                    ▼
             Dynamic Content
```

対応対象：

- 静的シェル生成
- Request-time Rendering
- Suspense境界
- Dynamic APIs
- `connection()`
- Prerender時の制約
- Cache Componentsとの連携

提案API：

```tsx
const result = await prerenderRoute("/dashboard");

expect(result.shell).toContain("Dashboard");

expect(result.dynamicBoundaries)
  .toHaveLength(1);
```

Next.jsの本番挙動と比較して検証すること。

---

# 13. React Concurrent Rendering

## 13.1 対応対象

- Suspense
- `use()`
- `useTransition()`
- `startTransition()`
- `useDeferredValue()`
- `useOptimistic()`
- 非同期レンダリング
- レンダリングの中断
- レンダリングの再試行
- Transition中のUI状態
- Error Boundaryとの連携

## 13.2 非同期テスト制御

テスト側から非同期処理の解決タイミングを制御できることを重視する。

例えば、Server Actionの完了前に楽観的UIが表示されることを確認する。

```tsx
const action = app.actions.defer("createPost");

await app.user.click(
  app.getByRole("button", { name: "投稿" }),
);

expect(
  app.getByText("送信中"),
).toBeDefined();

action.reject(new Error("Failed"));

await app.findByText("投稿に失敗しました");
```

このAPIは提案段階である。

React Schedulerを独自に再実装するのではなく、Reactの既存の処理をテスト側から観測・制御する設計とする。

---

# 14. Hydration

Hydrationの検証をClient Modeのオプションとして提供する。

```tsx
const result = await render(<Page />, {
  mode: "client",
  hydration: true,
});
```

実行フロー：

```text
RSC Render
     ↓
Flight
     ↓
SSR
     ↓
HTML
     ↓
turbo-dom
     ↓
hydrateRoot()
     ↓
Client Effects
```

検証対象：

- Hydration Mismatch
- `onRecoverableError`
- `useId()`
- Providerの初期状態
- SSRとClientの表示整合性
- Effectの実行
- StrictMode
- Hydration前のイベント

ただし、turbo-domによるHydrationが実ブラウザと完全に一致する保証はない。

そのため、テストの結果が保証する範囲を明示する。

---

# 15. Error Boundary

Next.jsの以下をサポートする。

- `error.tsx`
- `global-error.tsx`
- `not-found.tsx`
- `redirect()`
- `notFound()`
- `forbidden()`
- `unauthorized()`

また、ReactのError BoundaryとSuspense境界の相互作用を検証する。

重要なケース：

- Server Component内の例外
- Client Component内の例外
- Server Action内の例外
- Suspense中の例外
- Error Boundaryによる回復
- `reset()` の動作
- Nested LayoutsとError Boundaryの関係

エラー画面を直接差し込むのではなく、実際のReactレンダリング経路で例外が伝播することを検証する。

---

# 16. Metadataと特殊機能

## 16.1 Metadata API

対応対象：

- `metadata`
- `generateMetadata()`
- `generateViewport()`
- `generateStaticParams()`
- `sitemap.ts`
- `robots.ts`

提案API：

```tsx
const result = await renderRoute("/products/123");

expect(result.metadata.title)
  .toBe("Product 123");
```

Metadataの非同期処理やStreamingにも対応する。

## 16.2 after()

Next.jsの`after()`をサポートする。

レンダリング完了後の処理を別ライフサイクルとして管理する。

```tsx
const result = await renderRoute("/dashboard");

await result.lifecycle.flushAfter();

expect(logPageView).toHaveBeenCalled();
```

## 16.3 その他

以下も互換性テスト対象に含める。

- `next/dynamic`
- `next/image`
- `next/font`
- `server-only`
- `client-only`
- `useSyncExternalStore`
- Portals
- Zustand
- Redux
- TanStack Query
- Jotai
- 環境変数
- Node.js Runtime
- Edge Runtimeの非互換検出

これらすべてを独自実装する必要はない。

既存ライブラリが動作するための実行環境を提供し、必要な互換性テストを実施する。

---

# 17. Execution Context

Next.jsの実行フェーズを明確に分離する。

```typescript
type ExecutionPhase =
  | "prerender"
  | "request"
  | "rsc-render"
  | "ssr"
  | "hydration"
  | "client-navigation"
  | "server-action"
  | "revalidation"
  | "after-response";
```

ただし、実際には複数フェーズが並行・ネストする可能性がある。

そのため、単純な状態機械だけではなく、独立したコンテキストを持つ。

```typescript
interface RuntimeContext {
  request: RequestContext;
  render: RenderContext;
  cache: CacheContext;
  lifecycle: LifecycleContext;
}
```

Client Sessionについては別のコンテキストで管理する。

```typescript
interface ClientSessionContext {
  router: RouterContext;
  document: Document;
  reactRoot: unknown;
}
```

コンテキスト管理には、Bun上で利用可能なAsyncLocalStorageなどを検討する。

非同期処理の中でリクエストコンテキストが混線しないようにすること。

---

# 18. Testing API

## 18.1 公開API

基本APIは以下に絞る。

```typescript
renderRSC()
render()
renderRoute()
requestRoute()
prerenderRoute()
createTestContext()
```

React Testing LibraryのAPIを可能な限り再利用する。

## 18.2 単体RSCテスト

```tsx
import { test, expect } from "bun:test";
import { renderRSC } from "proofyard";

import Page from "./page";

test("ユーザーを表示する", async () => {
  const result = await renderRSC(<Page />);

  expect(result.getByText("Alice"))
    .toBeDefined();
});
```

## 18.3 Route統合テスト

```tsx
import { renderRoute } from "proofyard";

test("ダッシュボードを表示する", async () => {
  const result = await renderRoute("/dashboard", {
    mode: "client",
  });

  await result.findByText("Dashboard");
});
```

## 18.4 Request Context

```tsx
const result = await renderRoute("/dashboard", {
  cookies: {
    session: "test-session",
  },
  headers: {
    "x-test-user": "123",
  },
});
```

## 18.5 Server Actions

```tsx
const app = await renderRoute("/users/new", {
  mode: "client",
});

await app.user.type(
  app.getByRole("textbox"),
  "Alice",
);

await app.user.click(
  app.getByRole("button", { name: "Create" }),
);

await app.findByText("Created");
```

## 18.6 Client Router

```tsx
const app = await renderRoute("/dashboard", {
  mode: "client",
});

await app.router.push("/dashboard/users");

expect(app.router.pathname)
  .toBe("/dashboard/users");
```

## 18.7 モック

Bun標準のモックAPIを使用する。

```tsx
import { mock } from "bun:test";
```

独自モックシステムは原則実装しない。

ただし、RSCのモジュール変換前にモックを適用する仕組みが必要である。

Bunのモジュールキャッシュとモックの適用順序には注意する。

---

# 19. テスト間の分離

テスト高速化のために状態を再利用する場合でも、アプリケーションの状態汚染を起こしてはならない。

共有してよいもの：

- 不変のモジュール変換結果
- 不変のHTML解析結果
- 安全な静的メタデータ

分離するもの：

- DOM Document
- React Root
- Provider State
- Effect State
- Request Context
- React.cache()
- Cache Componentsのテスト用状態
- Router Cache
- Mock State
- Server Action Context

Client Modeでは、各テスト終了時にReact RootのunmountとEffectのクリーンアップを実施する。

共有状態を再利用する場合には、正しくリセットできることを保証する。

---

# 20. パフォーマンス設計

## 20.1 基本原則

**正確性を犠牲にせず、不要な実行処理だけを削減する。**

最適化対象：

- テスト起動
- モジュール読み込み
- モジュール変換
- Flight生成
- Flight復元
- DOM初期化
- Reactレンダリング
- テスト間のクリーンアップ
- メモリ消費

## 20.2 遅延初期化

RSC ModeではDOM関連ライブラリをロードしない。

SSR ModeではClient Runtimeを起動しない。

Client Modeでのみturbo-domとReact DOM Clientを初期化する。

```text
RSC Mode
  └── Flight

SSR Mode
  └── Flight + SSR

Client Mode
  └── Flight + React DOM + turbo-dom
```

## 20.3 キャッシュ

モジュール変換結果を再利用する。

turbo-domの不変HTML解析結果を再利用する。

ただし、Next.jsのアプリケーションキャッシュとは分離する。

## 20.4 並列実行

Bunの並列テスト機能を活用する。

ただし、次の状態は並列テスト間で共有してはならない。

- Global DOM
- Request Context
- Client Session
- React Root
- Application Cache

Workerやプロセス単位での分離も検討する。

DOMのグローバル登録が必要な場合、複数テストの同時実行で衝突しないようにする。

## 20.5 ベンチマーク

比較対象：

- Bunの通常ユニットテスト
- React Testing Library + happy-dom
- React Testing Library + turbo-dom
- vitest-plugin-rsc
- Playwright E2E

測定項目：

- Cold Start
- Warm Start
- 1テストあたりの実行時間
- 100テスト実行時間
- 1,000テスト実行時間
- メモリ使用量
- DOM初期化時間
- Flight処理時間
- Server Action実行時間
- テスト間クリーンアップ時間

速度について事前の倍率は保証しない。

実測値をもとに改善する。

---

# 21. ディレクトリ構成

初期段階では単一パッケージとして実装し、内部モジュールを分離する。

```text
proofyard/
│
├── src/
│   │
│   ├── core/
│   │   ├── runtime.ts
│   │   ├── context.ts
│   │   └── lifecycle.ts
│   │
│   ├── module/
│   │   ├── loader.ts
│   │   ├── transformer.ts
│   │   ├── server-graph.ts
│   │   ├── client-graph.ts
│   │   ├── client-reference.ts
│   │   └── server-reference.ts
│   │
│   ├── rendering/
│   │   ├── rsc-renderer.ts
│   │   ├── flight-encoder.ts
│   │   ├── flight-decoder.ts
│   │   ├── ssr-renderer.ts
│   │   ├── client-renderer.ts
│   │   └── suspense.ts
│   │
│   ├── dom/
│   │   ├── turbo-dom.ts
│   │   ├── environment.ts
│   │   ├── hydration.ts
│   │   └── cleanup.ts
│   │
│   ├── actions/
│   │   ├── registry.ts
│   │   ├── proxy.ts
│   │   ├── executor.ts
│   │   ├── serialization.ts
│   │   └── context.ts
│   │
│   ├── next/
│   │   ├── adapter.ts
│   │   ├── router/
│   │   ├── layouts/
│   │   ├── request/
│   │   ├── cache/
│   │   ├── proxy/
│   │   ├── metadata/
│   │   └── compiler/
│   │
│   ├── testing/
│   │   ├── render.ts
│   │   ├── render-rsc.ts
│   │   ├── render-route.ts
│   │   ├── request-route.ts
│   │   ├── prerender-route.ts
│   │   └── assertions.ts
│   │
│   └── index.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── compatibility/
│   ├── fixtures/
│   └── benchmarks/
│
├── examples/
│   └── next-app/
│
├── package.json
├── tsconfig.json
├── bunfig.toml
└── README.md
```

将来的には以下のパッケージへ分割できる設計とする。

```text
@proofyard/core
@proofyard/next
@proofyard/dom
```

ただし、初期開発でのパッケージ分割は必須としない。

---

# 22. 技術検証

実装前に以下の技術検証を行う。

## PoC 1：Bun + RSC Renderer

目的：

Bun上でReact公式RSC Rendererを実行できることを確認する。

対象：

- 非同期Server Components
- Flight Serialization
- Flight Deserialization
- Suspense
- シリアライズエラー

成功条件：

- Bunのみで動作
- ブラウザ不要
- Next.jsサーバー不要
- React公式のレンダリング経路を使用

## PoC 2：Server/Client境界

目的：

`"use client"` のモジュールをClient Referenceとして扱う。

対象：

```text
SC → CC → SC → CC
```

成功条件：

- Server GraphでClient Componentの実装を直接実行しない
- FlightでClient Referenceをシリアライズできる
- Client Runtimeで参照を解決できる
- Propsのシリアライズエラーを検出できる

**このPoCはプロジェクトの成立を左右する最重要項目である。**

## PoC 3：turbo-dom

目的：

Bun + React 19 + turbo-domの互換性を確認する。

対象：

- `createRoot()`
- `hydrateRoot()`
- `useEffect()`
- `useLayoutEffect()`
- Context
- Suspense
- DOM Events
- Forms
- Portals
- React Testing Library
- user-event

成功条件：

- Bun Testで正常に動作
- テスト間の状態分離が可能
- happy-domとの性能比較を実施

## PoC 4：Server Actions

目的：

Client ComponentからServer Actionを実行できることを確認する。

対象：

- `"use server"`
- Server Function Reference
- FormData
- `useActionState`
- Action Result
- RSC Refresh

成功条件：

- HTTP通信不要
- 引数・戻り値のシリアライズを検証
- Server Action実行
- Client UI更新

## PoC 5：Next.js App Router

目的：

既存Next.jsアプリのPageとLayoutを変更せずテストできることを確認する。

対象：

- Nested Layouts
- Dynamic Routes
- Cookies
- Headers
- Redirect
- Error Boundary

成功条件：

- 実際のNext.jsアプリケーションを利用
- Next.jsサーバー不要
- Route Resolutionが正しい

## PoC 6：Cache Components

目的：

Next.jsの`"use cache"`を本番と同じ意味論で実行できるか確認する。

対象：

- コンパイラ変換
- キャッシュキー
- `cacheLife`
- `cacheTag`
- 再検証
- テスト間の分離

成功条件：

- Next.js本体との比較テストに成功
- キャッシュ汚染が起こらない
- 未対応ケースを明示的に検出できる

---

# 23. 開発ロードマップ

## Phase 0：技術検証

最初に実施する。

- Bun + React RSC
- Flight
- Server/Client Module Graph
- turbo-dom
- React DOM Client
- Next.js Compiler互換性

実現可能性を確認したうえで本格実装する。

## Phase 1：Core RSC Testing

- `renderRSC()`
- 非同期Server Components
- Flight
- Server/Client境界
- Suspense
- シリアライズエラー
- テスト結果の検査API

この段階でRSC単体テストを実用化する。

## Phase 2：Client Integration

- turbo-dom
- React Testing Library
- `useEffect`
- Context
- Provider
- Events
- Forms
- SSR Mode
- Client Mode
- Hydration基盤

## Phase 3：Server Actions

- `"use server"`
- Action Registry
- Action Proxy
- FormData
- `useActionState`
- `useFormStatus`
- `useOptimistic`
- Action実行後のUI更新

## Phase 4：Next.js Integration

- App Router
- Nested Layouts
- Dynamic Routes
- Request Context
- Cookies
- Headers
- Redirect
- Error Boundary
- Route Handlers
- Proxy

## Phase 5：Client Navigation

- Client Router
- Router Cache
- Layout State
- Navigation History
- Parallel Routes
- Intercepting Routes
- `router.refresh()`
- Streaming Navigation

## Phase 6：Cache Components / PPR

- `"use cache"`
- Cache Components
- `cacheLife`
- `cacheTag`
- Revalidation
- PPR
- Prerender
- Static Shell
- Dynamic Boundaries

## Phase 7：高度な互換性

- Metadata
- `after()`
- StrictMode
- Hydration Mismatch
- Edge Runtimeの差異
- Dynamic Imports
- React Concurrent Rendering

## Phase 8：性能最適化

- モジュール変換キャッシュ
- DOM初期化最適化
- 並列テスト
- メモリ最適化
- ベンチマーク
- Watch Mode

---

# 24. 品質保証

## 24.1 Next.jsとの比較テスト

互換性の検証には、実際のNext.jsを使用する。

同じテストフィクスチャを以下の2環境で実行する。

```text
Test Fixture
     │
     ├── Next.js Reference
     │       ├── RSC
     │       ├── Flight
     │       ├── SSR
     │       └── Client
     │
     └── Proofyard
             ├── RSC
             ├── Flight
             ├── SSR
             └── Client
```

比較対象：

- レンダリング結果
- Flightの意味論
- HTML
- エラー
- Redirect
- Suspense
- Server Actions
- Cache Components
- Router State

Flightのバイト列そのものは内部形式や生成順序に依存する可能性があるため、常に完全一致を要求するのではなく、必要な意味論を比較する。

## 24.2 バージョン互換性

ReactとNext.jsのバージョン別テストを実施する。

ただし、すべての組み合わせをサポートすると保守負担が大きくなる。

初期段階では対象バージョンを限定する。

ReactとRSC関連パッケージについては、互換性が確認された組み合わせのみサポートする。

## 24.3 Fail Closed

未対応機能を通常のJavaScriptとして実行して、テストを成功させてはならない。

例えば、`"use cache"`のコンパイルが未実装の場合は、明示的にエラーとする。

```text
Unsupported Next.js feature:

Cache Components compilation is not supported
by the current runtime.
```

これは本プロジェクトの重要な設計原則である。

---

# 25. 受け入れ基準

初期リリースの受け入れ基準を以下とする。

### 必須

- `bun test`で実行できる。
- 実ブラウザを起動しない。
- Next.jsサーバーを起動しない。
- 非同期Server Componentsをテストできる。
- Flightのシリアライズを検証できる。
- シリアライズエラーを検出できる。
- SC → CC → SCの構造を扱える。
- Suspenseを検証できる。
- turbo-domでClient Componentsをレンダリングできる。
- `useEffect`を検証できる。
- Providerを扱える。
- Server Actionsの基本的な実行経路をテストできる。
- テスト間でDOMやRequest Contextが混線しない。
- 未対応のNext.js機能を検出できる。

### 初期リリース後

- App Routerの完全なLayout Resolution
- Client Router
- Router Cache
- Parallel Routes
- Intercepting Routes
- Cache Components
- PPR
- 高度なServer Actions
- Metadata
- Proxy
- Route Handlers
- Hydrationの高度な検証

ここでいう「初期リリース」は、最小限の実用的なRSCテスト環境を意味する。

Next.jsの全機能への対応は初期リリースの条件としない。

---

# 26. 最重要技術リスク

本プロジェクトの技術リスクは次の順に大きいと考える。

### リスク1：BunとReact RSCのモジュール解決

最も重要な問題。

React Server Componentsでは、Server/Clientで異なるモジュール解決が必要となる。

Bunの標準ローダーだけで正しく実現できるかは未検証。

Bunのローダーで不十分な場合、追加の変換レイヤーや分離された実行コンテキストが必要となる。

### リスク2：Next.jsコンパイラ依存

以下の機能はNext.jsのコンパイラと密接に結びついている。

- `"use client"`
- `"use server"`
- `"use cache"`
- Server Action Closure
- Cache Components

ReactのRSC Rendererだけで、Next.js本番の動作を完全には再現できない。

Next.jsのコンパイラを再利用する方法を調査する必要がある。

### リスク3：Client Routerの再現

`router.refresh()`やソフトナビゲーションでは、新しいRSC Payloadを既存のReactツリーにマージする。

単純な再レンダリングではClient Stateの保持が正確に再現できない。

Next.jsのRouter実装をどこまで再利用できるかが重要である。

### リスク4：Cache Components

Cache Componentsはコンパイラ、Request Context、Prerender、キャッシュストレージ、Revalidationなどに依存する。

独自実装では本番との意味論がずれやすい。

### リスク5：turbo-dom

turbo-domのBun互換性、React 19互換性、Hydration、フォームイベントの再現性は実機で検証する必要がある。

採用方針は維持しつつ、問題を早期発見できるテストを用意する。

---

# 27. 開発時の重要なルール

別のAIが本プロジェクトを実装する際には、以下を守ること。

**1. 実装済みと未実装を明確に区別する。**

設計上対応予定となっている機能を、実装済みとして扱わない。

**2. React内部処理を安易に再実装しない。**

既存のReact RSC Renderer、React DOM、Flight実装を優先する。

**3. Next.jsの動作を推測で再現しない。**

可能な限りNext.jsの実装を参照し、比較テストを用意する。

**4. 高速化のためにFlightを省略しない。**

RSC特有のシリアライズエラーを検出する必要がある。

**5. Server/Client境界を壊さない。**

Client ComponentをServer Componentとして直接実行してはならない。

**6. キャッシュのスコープを守る。**

テスト高速化用キャッシュとアプリケーションキャッシュを分離する。

**7. turbo-domを標準DOM実装とする。**

ただし、DOM Adapter境界を維持し、互換性問題に備える。

**8. 不必要なブラウザ・サーバー・バンドラーを起動しない。**

ただし、必要な変換処理まで無条件に排除しない。

**9. 正確性を性能より優先する。**

高速でも不正確なテストは価値がない。

**10. 技術検証から実装を開始する。**

特に、Bun + React RSC Renderer + Flight + Client Referenceの成立を確認するまでは、大規模な実装を進めない。

---

# 28. 最終目標

最終的には、次のようなテストを実行できることを目指す。

```tsx
import { test, expect } from "bun:test";
import { renderRoute } from "proofyard";

test("ユーザー作成から一覧更新まで", async () => {
  const app = await renderRoute("/users", {
    mode: "client",
    cookies: {
      session: "test-session",
    },
  });

  await app.user.click(
    app.getByRole("button", {
      name: "新規作成",
    }),
  );

  await app.user.type(
    app.getByRole("textbox", {
      name: "名前",
    }),
    "Alice",
  );

  await app.user.click(
    app.getByRole("button", {
      name: "保存",
    }),
  );

  await app.findByText("Alice");

  expect(
    app.actions.getCalls("createUser"),
  ).toHaveLength(1);

  expect(
    app.cache.getInvalidatedTags(),
  ).toContain("users");
});
```

このテストでは、以下がすべて実行される想定である。

```text
Bun Test
   │
   ▼
Next.js Route Resolution
   │
   ▼
Nested Layouts
   │
   ▼
React Server Components
   │
   ▼
Flight Serialization
   │
   ▼
Flight Deserialization
   │
   ▼
React DOM Client
   │
   ▼
turbo-dom
   │
   ▼
User Interaction
   │
   ▼
Server Action
   │
   ▼
Cache Invalidation
   │
   ▼
RSC Re-render
   │
   ▼
Client UI Update
   │
   ▼
Assertions
```

これらを**Next.jsサーバーも実ブラウザも起動せず、Bunプロセス内で完結させる**。

なお、コード中のAPIは最終的な開発体験を示す仕様案であり、動作検証済みの実装ではない。

---

# 29. 最終方針

本プロジェクトでは、次の3点を最優先とする。

**正確性：** React RSCとNext.jsの実際の動作に可能な限り一致させる。

**速度：** ブラウザ・サーバー・不要なバンドル処理を排除し、Bunで高速に実行する。

**保守性：** React・Next.jsの内部実装への依存を限定し、Adapterと互換性テストによってバージョン変更に追従する。

最初に取り組むべき技術課題は、**Bun上でServer/Clientモジュールグラフを分離し、React公式のRSC RendererとFlightを正しく動作させること**である。

これが成立した後、turbo-domによるClient Runtime、Server Actions、Next.js App Router、Cache Componentsへと段階的に拡張する。

**本仕様書は最終到達目標を定義したものであり、すべての機能の実現可能性が検証されているわけではない。実装AIは、まずPoCと互換性テストによって各技術的前提を確認すること。**
