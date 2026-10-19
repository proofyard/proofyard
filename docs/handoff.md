# Proofyard 引き継ぎメモ（2026-10-19）

## プロジェクト

Next.js App Router の React Server Components を、ブラウザも Next.js サーバーも起動せず、Bun（`bun test`）の中だけでテストするフレームワーク。

- 仕様書: `docs/spec.md`（v1.0、設計段階）。**必ず最初に全文を読むこと**
- 現状: コードは0行。`~/prj/proofyard/` には `docs/` だけがある。git 未初期化

## これまでに決めたこと

- **名前は Proofyard**。武器を試射して動作と安全を確かめる試験場（proof yard）に由来し、「本物の経路を通して検証する」という設計方針に合わせた
- 名前の制約: 「bun」「flight」「next」は使わない（オーナーの希望、Next.js は商標）
- 2026-10-19 時点の空き状況:

| 対象 | 状態 |
|---|---|
| npm `proofyard`、スコープ `@proofyard` | 空き |
| GitHub `github.com/proofyard` | 空き |
| GitHub で proofyard という名前のリポジトリ | 0件 |
| `proofyard.com`（2010年から登録） | 登録済み |
| `proofyard.dev`（2026-07-17 に登録。**最近取られた**） | 登録済み |

- npm と GitHub の名前は**オーナーが自分のアカウントで確保する**。AI からは公開・Organization 作成をしない

## 次のタスク（順番）

1. **名前の確保を待つ**: オーナーが GitHub の Organization `proofyard` と npm の `proofyard`（仮の 0.0.0）を確保する。済んでいるかはオーナーに確認する
2. **リポジトリの初期化**: `git init`、`package.json`（name: `proofyard`、MIT）、`tsconfig.json`、`bunfig.toml`。仕様21章の構成は、PoC で必要になった分だけ作る
3. **PoC 1（仕様22章）**: Bun 上で React 公式の RSC Renderer を動かし、Flight でシリアライズ・デシリアライズする。非同期の Server Component、Suspense、シリアライズエラーを含める
   - 先に `react-server-dom-webpack` と `react-server-dom-turbopack` のどちらを使うかを決める
   - React と RSC 関連パッケージは、互換性のあるバージョンに厳密に固定する
4. **PoC 2（最重要）**: `"use client"` のモジュールを Client Reference として扱う
   - 構成は SC → CC → SC → CC
   - 仕様26章のリスク1「Bun のローダーやプラグイン API だけで、Server と Client のモジュールグラフを分けられるか」の検証を兼ねる
   - **この PoC が通らなければプロジェクトは成り立たない。結果をオーナーに報告し、続けるかどうかの判断を仰ぐ**
5. PoC 3 以降（turbo-dom、Server Actions、App Router、Cache Components）は、PoC 1 と PoC 2 の結果を見てから進める

## 守ること（仕様27章の要約）

- 実装済みのものと未実装のものを明確に分ける。予定の機能を実装済みとして扱わない
- React の内部処理を自前で再実装しない。たとえば `await Page()` での評価は禁止。公式の Renderer と Flight を使う
- 速くするために Flight を省略しない。`JSON.stringify` で代用しない
- Client Component をサーバー側で直接実行しない
- 未対応の機能はテストを通さず、明示的にエラーにする（Fail Closed）
- Next.js の動作を推測で再現しない。実際の Next.js と比べるテストで確かめる
- 正確さを速度より優先する

## まだ検証していない前提

- Bun で RSC のモジュール解決（`react-server` 条件）ができるか
- turbo-dom（https://github.com/miaskiewicz/turbo-dom）が Bun と React 19 で動くか、happy-dom より速いか
- Next.js のコンパイラ（`"use server"` のクロージャ変換、`"use cache"`）を再利用できるか
- 名前の商標調査（USPTO、J-PlatPat）
