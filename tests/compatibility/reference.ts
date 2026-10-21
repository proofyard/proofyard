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
  if (!build.success) throw new Error(`next build failed in ${dir}\n${build.stdout}\n${build.stderr}`);
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
    .replace(/<meta name="next-size-adjust"[^>]*>/g, "");
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
