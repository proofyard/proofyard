// 仕様 24.1: 同じフィクスチャを本物の Next.js（next build --webpack と next start）でも動かし、結果を比べる。
// 本物の next build は TypeScript のファイルがあると TypeScript を自動でインストールするので、JS に変換した写しで動かす
// （型だけを消して JSX は残す。Next.js 同梱の SWC）
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

// oxlint-disable-next-line unicorn/prefer-module -- Next.js の内部の CJS（SWC）を読む
const { transformSync } = require("next/dist/build/swc");

const root = nodePath.resolve(import.meta.dir, "../..");

const copyAsJs = async (from: string, to: string, exclude: string[]) => {
  for (const name of readdirSync(from)) {
    const source = nodePath.join(from, name);
    if (
      name === "node_modules" ||
      name === ".next" ||
      exclude.includes(source)
    ) {
      continue;
    }
    if (statSync(source).isDirectory()) {
      // oxlint-disable-next-line no-await-in-loop -- ファイルを順番に写す
      await copyAsJs(source, nodePath.join(to, name), exclude);
      continue;
    }
    mkdirSync(to, { recursive: true });
    if (name === "tsconfig.json") {
      // paths などはそのまま jsconfig.json に（Next.js の loadJsConfig はどちらも読む）
      const { compilerOptions } = JSON.parse(readFileSync(source, "utf-8"));
      writeFileSync(
        nodePath.join(to, "jsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            baseUrl: compilerOptions.baseUrl,
            paths: compilerOptions.paths,
          },
        })
      );
    } else if (/\.tsx?$/u.test(name) && !name.endsWith(".d.ts")) {
      // oxlint-disable-next-line no-await-in-loop -- ファイルを順番に写す
      const { code } = await transformSync(readFileSync(source, "utf-8"), {
        filename: source,
        jsc: {
          parser: { syntax: "typescript", tsx: name.endsWith(".tsx") },
          target: "esnext",
          transform: { react: { runtime: "preserve" } },
        },
        sourceMaps: false,
      });
      // next.config は ESM（package.json の type がないので .mjs）
      const out = name.startsWith("next.config.")
        ? "next.config.mjs"
        : name.replace(/\.ts(?<x>x?)$/u, ".js$1");
      writeFileSync(nodePath.join(to, out), code);
    } else {
      cpSync(source, nodePath.join(to, name));
    }
  }
};

export interface Reference {
  url: string;
  dir: string;
  stop: () => Promise<void>;
}

const safeReaddir = (dir: string) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

// フィクスチャを本物の Next.js でビルドして起動する。exclude: 写さないもの（フィクスチャからの相対パス。next build が失敗するページなど）
export const startReference = async (
  fixture: string,
  { exclude = [] }: { exclude?: string[] } = {}
): Promise<Reference> => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "proofyard-reference-"));
  await copyAsJs(
    fixture,
    dir,
    exclude.map((path) => nodePath.join(fixture, path))
  );
  // node_modules: プロジェクトのもの（next、react など）と、フィクスチャのもの（偽のサードパーティのパッケージ）。
  // ディレクトリごとのリンクにはしない（next build が依存をインストールしても、プロジェクトの node_modules を書き換えない）
  const modules = nodePath.join(dir, "node_modules");
  mkdirSync(modules);
  for (const base of [
    nodePath.join(root, "node_modules"),
    nodePath.join(fixture, "node_modules"),
  ]) {
    for (const name of safeReaddir(base)) {
      if (name === ".bin" || name === ".cache") {
        continue;
      }
      const scoped = name.startsWith("@");
      for (const entry of scoped
        ? safeReaddir(nodePath.join(base, name)).map((n) => `${name}/${n}`)
        : [name]) {
        const link = nodePath.join(modules, entry);
        mkdirSync(nodePath.dirname(link), { recursive: true });
        try {
          symlinkSync(nodePath.join(base, entry), link);
        } catch {
          // フィクスチャの node_modules は後から（同じ名前はプロジェクトのものを使う）
        }
      }
    }
  }
  const next = nodePath.join(root, "node_modules/next/dist/bin/next");
  const build = Bun.spawnSync(["node", next, "build", "--webpack"], {
    cwd: dir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (!build.success) {
    rmSync(dir, { force: true, recursive: true });
    throw new Error(`next build failed\n${build.stdout}\n${build.stderr}`);
  }
  const port = 4000 + Math.floor(Math.random() * 2000);
  // 静的シェルのデバッグ（?__nextppronly）を有効にする。クエリがなければ next start の動作は変わらない
  const server = Bun.spawn(["node", next, "start", "-p", String(port)], {
    cwd: dir,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      __NEXT_EXPERIMENTAL_STATIC_SHELL_DEBUGGING: "1",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; ; i += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- 起動するまで順番に問い合わせる
      await fetch(url, { redirect: "manual" });
      break;
    } catch {
      if (i > 100) {
        throw new Error(`next start did not respond (${dir})`);
      }
      // oxlint-disable-next-line no-await-in-loop -- 起動するまで順番に問い合わせる
      await Bun.sleep(100);
    }
  }
  return {
    dir,
    stop: async () => {
      server.kill();
      await server.exited;
      rmSync(dir, { force: true, recursive: true });
    },
    url,
  };
};

// 比べるための HTML: 実行ごと・ビルドごとに変わるもの（script、ビルド ID、チャンクのファイル名、RSC のペイロード）を除き、
// 後から流れてきた Suspense の中身をブラウザ（React の $RC）と同じく fallback と入れ替える。
// next start は PPR のルートを静的シェルの続き（resume）で返すが、requestRoute は毎回ページ全体をリクエスト時に描画する
export const comparableHtml = (source: string) => {
  const html = source
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gu, "")
    .replaceAll(/<link\b[^>]*>/gu, "")
    .replaceAll(/<meta name="next-size-adjust"[^>]*>/gu, "")
    // JS に変えた写しでビルドするので変わるもの: Server Action の id（ファイル名から）、メタデータの画像の URL の [contenthash]
    .replaceAll(/\$ACTION_ID_[0-9a-f]+/gu, "$ACTION_ID_<id>")
    .replaceAll(/\?[0-9a-f]{16}"/gu, '?<contenthash>"');
  // 流れてきた中身は body の最後に <div hidden id="S:n">…</div> で並ぶ
  const [page = "", ...segments] = html.split(/<div hidden id="S:/u);
  let result = page;
  const last = segments.at(-1);
  const tail =
    last === undefined ? "" : last.slice(last.lastIndexOf("</div>") + 6);
  for (const [i, segment] of segments.entries()) {
    const id = segment.slice(0, segment.indexOf('"'));
    const end =
      i === segments.length - 1
        ? segment.lastIndexOf("</div>")
        : segment.length - 6;
    const content = segment.slice(segment.indexOf(">") + 1, end);
    // ponytail: fallback の中に入れ子の Suspense があると、最初の <!--/$--> で切れる
    result = result.replace(
      new RegExp(
        `<!--\\$\\?--><template id="B:${id}"></template>[\\s\\S]*?<!--/\\$-->`,
        "u"
      ),
      () => `<!--$-->${content}<!--/$-->`
    );
  }
  return result + tail;
};

// Flight の意味論の比較（仕様 24.1）: バイト列（行の番号、モジュールの id）ではなく、React の Flight クライアントでデコードした値を比べる。
// Client Component は「モジュールのパス#export 名」にする（本物の id は webpack の数字なので client-reference-manifest でパスに戻す）
const {
  createFromReadableStream,
  // oxlint-disable-next-line unicorn/prefer-module -- Next.js 同梱の Flight クライアント（CJS）を読む
} = require("next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js");

const CLIENT = Symbol("client");
// 本物の webpack のモジュールの id → ファイルのパス
export const referenceModulePaths = (reference: Reference) => {
  const paths = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith("_client-reference-manifest.js")) {
        const scope: {
          __RSC_MANIFEST?: Record<
            string,
            { clientModules: Record<string, { id: string | number }> }
          >;
        } = {};
        // oxlint-disable-next-line no-new-func -- next build が出す manifest のスクリプトを評価する
        new Function("globalThis", readFileSync(path, "utf-8"))(scope);
        // oxlint-disable-next-line typescript/no-non-null-assertion -- manifest がなければ例外で落ちてよい
        for (const manifest of Object.values(scope.__RSC_MANIFEST!)) {
          for (const [file, { id }] of Object.entries(manifest.clientModules)) {
            paths.set(String(id), file);
          }
        }
      }
    }
  };
  walk(nodePath.join(reference.dir, ".next/server/app"));
  return paths;
};

// モジュールのパスを比べられる形に: アプリのディレクトリ（JS に変えた写しと元のフィクスチャ）、拡張子、Next.js の ESM 版と CJS 版の違いを除く
export const comparableModule = (path: string, appDirs: string[]) => {
  let p = path;
  for (const dir of appDirs) {
    p = p.replace(dir, "<app>");
  }
  return p.replace("/dist/esm/", "/dist/").replace(/\.[cm]?[jt]sx?$/u, "");
};

/* oxlint-disable no-use-before-define -- settleObject と settle は互いに呼ぶ */
// React の要素などの中身（Promise・lazy・要素・配列・Map・Set・オブジェクト）を settle する
const settleObject = async (
  // oxlint-disable-next-line typescript/no-explicit-any -- Flight でデコードした任意の値をたどる
  value: any,
  seen: Set<object>
): Promise<unknown> => {
  if (value.$$typeof === Symbol.for("react.lazy")) {
    for (;;) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- lazy が解決するまで順番に待つ
        return await settle(value._init(value._payload), seen);
      } catch (error) {
        const thrown = error as { then?: unknown; message?: unknown } | null;
        if (typeof thrown?.then !== "function") {
          return { thrown: String(thrown?.message ?? thrown) };
        }
        // oxlint-disable-next-line no-await-in-loop -- lazy が解決するまで順番に待つ
        await (error as Promise<unknown>).then(undefined, () => null);
      }
    }
  }
  if (value.$$typeof === Symbol.for("react.transitional.element")) {
    const type = await settle(value.type, seen);
    // Viewport と Metadata の key はリクエストの id（app-render.tsx の getFlightViewportKey / getFlightMetadataKey）
    const key =
      typeof value.key === "string"
        ? value.key.replace(/^[\w-]{21}(?<kind>[vm])$/u, "<request-id>$1")
        : value.key;
    const props = await settle(value.props, seen);
    return { key, props, type };
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      // oxlint-disable-next-line no-await-in-loop -- seen を共有するので順番にたどる
      out.push(await settle(item, seen));
    }
    return out;
  }
  if (value instanceof Map || value instanceof Set) {
    return { [value.constructor.name]: await settle([...value], seen) };
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    // oxlint-disable-next-line no-await-in-loop -- seen を共有するので順番にたどる
    out[key] = await settle(item, seen);
  }
  return out;
};

/* oxlint-enable no-use-before-define */
// Promise と lazy を待ち、React の要素を { type, key, props } にする
const settle = async (
  // oxlint-disable-next-line typescript/no-explicit-any -- Flight でデコードした任意の値をたどる
  input: any,
  seen: Set<object>
): Promise<unknown> => {
  let value = input;
  if (typeof value?.then === "function") {
    try {
      value = await value;
    } catch (error) {
      return {
        rejected: String(
          (error as { message?: unknown } | null)?.message ?? error
        ),
      };
    }
  }
  if (typeof value === "symbol") {
    return value.description;
  }
  if (typeof value === "function") {
    return value[CLIENT] ? { client: value[CLIENT] } : "function";
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[cycle]";
  }
  seen.add(value);
  try {
    return await settleObject(value, seen);
  } finally {
    seen.delete(value);
  }
};

export const comparableFlight = async (
  text: string,
  modulePath: (id: string) => string
) => {
  // Next.js 同梱の Flight クライアントは __next_require__ でモジュールを、__webpack_chunk_load__ でチャンクを読む。
  // 読み込みの代わりに、どの export でも印を付けた関数を返す。Proofyard の SSR も同じグローバルを使うので、終わったら戻す
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = [g.__next_require__, g.__webpack_chunk_load__];
  g.__next_require__ = (id: unknown) =>
    new Proxy(
      {},
      {
        get: (_, name) =>
          name === "then" || typeof name === "symbol"
            ? undefined
            : Object.assign(() => null, {
                [CLIENT]: `${modulePath(String(id))}#${name}`,
              }),
        getOwnPropertyDescriptor: (target, name) =>
          name === "then"
            ? undefined
            : {
                configurable: true,
                enumerable: true,
                value: (target as Record<PropertyKey, unknown>)[name],
                writable: false,
              },
        has: (_, name) => name !== "then",
      }
    );
  g.__webpack_chunk_load__ = () => Promise.resolve();
  try {
    const decoded = await createFromReadableStream(new Response(text).body, {
      serverConsumerManifest: {
        moduleLoading: null,
        moduleMap: null,
        serverModuleMap: null,
      },
    });
    const value = (await settle(decoded, new Set())) as Record<string, unknown>;
    // ビルド ID と、静的な部分のバイト数（a、l。モジュールの id の長さで変わる）
    delete value.b;
    delete value.a;
    delete value.l;
    return value;
  } finally {
    [g.__next_require__, g.__webpack_chunk_load__] = saved;
  }
};
