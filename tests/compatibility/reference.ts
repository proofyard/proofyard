// 仕様 24.1: 同じフィクスチャを本物の Next.js（next build --webpack と next start）でも動かし、結果を比べる。
// 本物の next build は TypeScript のファイルがあると TypeScript を自動でインストールするので、JS に変換した写しで動かす
// （型だけを消して JSX は残す。Next.js 同梱の SWC）
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const { transformSync } = require("next/dist/build/swc");
const root = resolve(import.meta.dir, "../..");

async function copyAsJs(from: string, to: string, exclude: string[]) {
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    if (name === "node_modules" || name === ".next" || exclude.includes(source)) continue;
    if (statSync(source).isDirectory()) {
      await copyAsJs(source, join(to, name), exclude);
      continue;
    }
    mkdirSync(to, { recursive: true });
    if (name === "tsconfig.json") {
      // paths などはそのまま jsconfig.json に（Next.js の loadJsConfig はどちらも読む）
      const { compilerOptions } = JSON.parse(readFileSync(source, "utf8"));
      writeFileSync(join(to, "jsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: compilerOptions.baseUrl, paths: compilerOptions.paths } }));
    } else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      const { code } = await transformSync(readFileSync(source, "utf8"), {
        filename: source,
        jsc: { parser: { syntax: "typescript", tsx: name.endsWith(".tsx") }, target: "esnext", transform: { react: { runtime: "preserve" } } },
        sourceMaps: false,
      });
      // next.config は ESM（package.json の type がないので .mjs）
      const out = name.startsWith("next.config.") ? "next.config.mjs" : name.replace(/\.ts(x?)$/, ".js$1");
      writeFileSync(join(to, out), code);
    } else cpSync(source, join(to, name));
  }
}

export type Reference = { url: string; dir: string; stop: () => Promise<void> };

// フィクスチャを本物の Next.js でビルドして起動する。exclude: 写さないもの（フィクスチャからの相対パス。next build が失敗するページなど）
export async function startReference(fixture: string, { exclude = [] }: { exclude?: string[] } = {}): Promise<Reference> {
  const dir = mkdtempSync(join(tmpdir(), "proofyard-reference-"));
  await copyAsJs(fixture, dir, exclude.map((path) => join(fixture, path)));
  // node_modules: プロジェクトのもの（next、react など）と、フィクスチャのもの（偽のサードパーティのパッケージ）。
  // ディレクトリごとのリンクにはしない（next build が依存をインストールしても、プロジェクトの node_modules を書き換えない）
  const modules = join(dir, "node_modules");
  mkdirSync(modules);
  for (const base of [join(root, "node_modules"), join(fixture, "node_modules")])
    for (const name of safeReaddir(base)) {
      if (name === ".bin" || name === ".cache") continue;
      const scoped = name.startsWith("@");
      for (const entry of scoped ? safeReaddir(join(base, name)).map((n) => `${name}/${n}`) : [name]) {
        const link = join(modules, entry);
        mkdirSync(dirname(link), { recursive: true });
        try {
          symlinkSync(join(base, entry), link);
        } catch {} // フィクスチャの node_modules は後から（同じ名前はプロジェクトのものを使う）
      }
    }
  const next = join(root, "node_modules/next/dist/bin/next");
  const build = Bun.spawnSync(["node", next, "build", "--webpack"], { cwd: dir, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  if (!build.success) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`next build failed\n${build.stdout}\n${build.stderr}`);
  }
  const port = 4000 + Math.floor(Math.random() * 2000);
  const server = Bun.spawn(["node", next, "start", "-p", String(port)], { cwd: dir, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdout: "pipe", stderr: "pipe" });
  const url = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    try {
      await fetch(url, { redirect: "manual" });
      break;
    } catch {
      if (i > 100) throw new Error(`next start did not respond (${dir})`);
      await Bun.sleep(100);
    }
  }
  return {
    url,
    dir,
    stop: async () => {
      server.kill();
      await server.exited;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function safeReaddir(dir: string) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// 比べるための HTML: 実行ごと・ビルドごとに変わるもの（script、ビルド ID、チャンクのファイル名、RSC のペイロード）を除き、
// 後から流れてきた Suspense の中身をブラウザ（React の $RC）と同じく fallback と入れ替える。
// next start は PPR のルートを静的シェルの続き（resume）で返すが、requestRoute は毎回ページ全体をリクエスト時に描画する（docs/handoff.md）
export function comparableHtml(html: string) {
  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<link\b[^>]*>/g, "")
    .replace(/<meta name="next-size-adjust"[^>]*>/g, "")
    // JS に変えた写しでビルドするので変わるもの: Server Action の id（ファイル名から）、メタデータの画像の URL の [contenthash]
    .replace(/\$ACTION_ID_[0-9a-f]+/g, "$ACTION_ID_<id>")
    .replace(/\?[0-9a-f]{16}"/g, '?<contenthash>"');
  // 流れてきた中身は body の最後に <div hidden id="S:n">…</div> で並ぶ
  const [page, ...segments] = html.split(/<div hidden id="S:/);
  let result = page!;
  const tail = segments.length ? segments.at(-1)!.slice(segments.at(-1)!.lastIndexOf("</div>") + 6) : "";
  for (const [i, segment] of segments.entries()) {
    const id = segment.slice(0, segment.indexOf('"'));
    const end = i === segments.length - 1 ? segment.lastIndexOf("</div>") : segment.length - 6;
    const content = segment.slice(segment.indexOf(">") + 1, end);
    // ponytail: fallback の中に入れ子の Suspense があると、最初の <!--/$--> で切れる
    result = result.replace(new RegExp(`<!--\\$\\?--><template id="B:${id}"></template>[\\s\\S]*?<!--/\\$-->`), () => `<!--$-->${content}<!--/$-->`);
  }
  return result + tail;
}

// Flight の意味論の比較（仕様 24.1）: バイト列（行の番号、モジュールの id）ではなく、React の Flight クライアントでデコードした値を比べる。
// Client Component は「モジュールのパス#export 名」にする（本物の id は webpack の数字なので client-reference-manifest でパスに戻す）
const { createFromReadableStream } = require("next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js");
const CLIENT = Symbol("client");
// ルーターの木の prefetch hints（PrefetchHint）のうち、next build の測定（prefetch hints manifest）から来るもの。
// Proofyard は build のときのプリレンダリングをしないので、Next.js の代わりの値（全部 PrefetchDisabled）になる（docs/handoff.md）。
// InliningHintsStale (512)、インライン化 (32, 64, 128, 256)、PrefetchDisabled (1024)、ShouldAttemptStaticShell / Prefetch
const BUILD_PREFETCH_HINTS = 32 | 64 | 128 | 256 | 512 | 1024 | (1 << 14) | (1 << 15);

// 本物の webpack のモジュールの id → ファイルのパス
export function referenceModulePaths(reference: Reference) {
  const paths = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith("_client-reference-manifest.js")) {
        const scope: { __RSC_MANIFEST?: Record<string, { clientModules: Record<string, { id: string | number }> }> } = {};
        new Function("globalThis", readFileSync(path, "utf8"))(scope);
        for (const manifest of Object.values(scope.__RSC_MANIFEST!))
          for (const [file, { id }] of Object.entries(manifest.clientModules)) paths.set(String(id), file);
      }
    }
  };
  walk(join(reference.dir, ".next/server/app"));
  return paths;
}

// モジュールのパスを比べられる形に: アプリのディレクトリ（JS に変えた写しと元のフィクスチャ）、拡張子、Next.js の ESM 版と CJS 版の違いを除く
export const comparableModule = (path: string, appDirs: string[]) =>
  appDirs.reduce((p, dir) => p.replace(dir, "<app>"), path).replace("/dist/esm/", "/dist/").replace(/\.[cm]?[jt]sx?$/, "");

export async function comparableFlight(text: string, modulePath: (id: string) => string) {
  // Next.js 同梱の Flight クライアントは __next_require__ でモジュールを、__webpack_chunk_load__ でチャンクを読む。
  // 読み込みの代わりに、どの export でも印を付けた関数を返す。Proofyard の SSR も同じグローバルを使うので、終わったら戻す
  const g = globalThis as any;
  const saved = [g.__next_require__, g.__webpack_chunk_load__];
  g.__next_require__ = (id: unknown) =>
    new Proxy(
      {},
      {
        get: (_, name) => (name === "then" || typeof name === "symbol" ? undefined : Object.assign(() => null, { [CLIENT]: `${modulePath(String(id))}#${name}` })),
        has: (_, name) => name !== "then",
        getOwnPropertyDescriptor: (target, name) => (name === "then" ? undefined : { value: (target as any)[name], configurable: true, enumerable: true, writable: false }),
      },
    );
  g.__webpack_chunk_load__ = () => Promise.resolve();
  try {
    const root = await createFromReadableStream(new Response(text).body, { serverConsumerManifest: { moduleMap: null, serverModuleMap: null, moduleLoading: null } });
    const value = (await settle(root, new Set())) as Record<string, unknown>;
    // ビルド ID と、静的な部分のバイト数（a、l。モジュールの id の長さで変わる）
    for (const key of ["b", "a", "l"]) delete value[key];
    return value;
  } finally {
    [g.__next_require__, g.__webpack_chunk_load__] = saved;
  }
}

// Promise と lazy を待ち、React の要素を { type, key, props } にする
async function settle(value: any, seen: Set<object>): Promise<unknown> {
  if (typeof value?.then === "function") {
    try {
      value = await value;
    } catch (error: any) {
      return { rejected: String(error?.message ?? error) };
    }
  }
  if (typeof value === "symbol") return value.description;
  if (typeof value === "function") return value[CLIENT] ? { client: value[CLIENT] } : "function";
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[cycle]";
  seen.add(value);
  try {
    if (value.$$typeof === Symbol.for("react.lazy"))
      for (;;)
        try {
          return await settle(value._init(value._payload), seen);
        } catch (thrown: any) {
          if (typeof thrown?.then !== "function") return { thrown: String(thrown?.message ?? thrown) };
          await thrown.then(undefined, () => {});
        }
    if (value.$$typeof === Symbol.for("react.transitional.element"))
      return {
        type: await settle(value.type, seen),
        // Viewport と Metadata の key はリクエストの id（app-render.tsx の getFlightViewportKey / getFlightMetadataKey）
        key: typeof value.key === "string" ? value.key.replace(/^[\w-]{21}([vm])$/, "<request-id>$1") : value.key,
        props: await settle(value.props, seen),
      };
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) out.push(await settle(item, seen));
      return out;
    }
    if (value instanceof Map || value instanceof Set) return { [value.constructor.name]: await settle([...value], seen) };
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value))
      if (key !== "h" || typeof item !== "number" || !("s" in value)) out[key] = await settle(item, seen);
      // Next.js は 0 のときは h を省く
      else if (item & ~BUILD_PREFETCH_HINTS) out[key] = item & ~BUILD_PREFETCH_HINTS;
    return out;
  } finally {
    seen.delete(value);
  }
}
