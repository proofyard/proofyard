// PoC 2: 同じ Bun プロセスの中で Server Graph と Client Graph を分ける。
//
// - Client Graph: Bun の通常の読み込み（条件なし）。テストファイルもここ。
// - Server Graph のアプリソース: パス末尾に "?rsc" を付けた別インスタンスとして、このプラグインが読む。
// - Server Graph のパッケージ: Bun.build で `react-server` 条件の ESM バンドル（server vendor）にまとめる。
//
// ランタイムプラグインだけで分けられない理由（Bun 1.4.2 で実測）:
// - onResolve にはパッケージ名（"react"）が届かない。Bun が先に解決してしまう。CJS の require("react") は届きすらしない
// - onLoad で返した中身は ESM 扱いになり、CJS を返すと exports が空になる
// - Worker にも `--conditions` は個別に渡せない
import { plugin } from "bun";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

export const RSC = "?rsc";

// "use client" のモジュール ID -> ファイルパス（Client Runtime での解決に使う）
export const clientModules = new Map<string, string>();

// Server Graph から import してよいパッケージ。
// ponytail: 固定リスト。アプリが使うパッケージを事前に走査してバンドルの入口を決める形に置き換える
const SERVER_PACKAGES = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-server-dom-turbopack/server",
];

const vendorDir = join(import.meta.dir, "../../../node_modules/.cache/proofyard/server-vendor");

// spec -> facade モジュールのパス（名前付き export を持つ ESM）
const serverPackages = await buildServerVendor();

async function buildServerVendor() {
  const srcDir = join(vendorDir, "src");
  mkdirSync(srcDir, { recursive: true });
  const name = (spec: string) => spec.replaceAll("/", "__");
  for (const spec of SERVER_PACKAGES) {
    writeFileSync(join(srcDir, `${name(spec)}.js`), `export default require(${JSON.stringify(spec)});\n`);
  }
  const out = join(vendorDir, "out");
  const result = await Bun.build({
    entrypoints: SERVER_PACKAGES.map((spec) => join(srcDir, `${name(spec)}.js`)),
    outdir: out,
    target: "bun",
    format: "esm",
    splitting: true, // React を1インスタンスにする
    conditions: ["react-server"],
  });
  if (!result.success) throw new AggregateError(result.logs, "[proofyard] server vendor build failed");

  // CJS の default を名前付き export に展開する facade
  const map = new Map<string, string>();
  for (const spec of SERVER_PACKAGES) {
    const bundle = join(out, `${name(spec)}.js`);
    const keys = Object.keys((await import(bundle)).default).filter((k) => k !== "default" && /^[A-Za-z_$][\w$]*$/.test(k));
    const facade = join(vendorDir, `${name(spec)}.facade.js`);
    writeFileSync(facade, `import m from ${JSON.stringify(bundle)};\nexport const { ${keys.join(", ")} } = m;\nexport default m;\n`);
    map.set(spec, facade);
  }
  return map;
}

// 静的 import は onResolve を通らないので、Server Graph のソースは import 指定子を解決済みパスに書き換える。
// ponytail: 指定子の文字列置換。同じ文字列リテラルが import 以外にあると巻き込む。AST 変換（Next.js コンパイラ）で置き換える
function linkServer(code: string, fromDir: string): string {
  const specs = new Set(new Bun.Transpiler({ loader: "js" }).scan(code).imports.map((i) => i.path));
  for (const spec of specs) {
    let target: string;
    if (spec.endsWith(RSC) || spec.startsWith("node:")) continue;
    else if (spec.startsWith(".") || spec.startsWith("/")) target = Bun.resolveSync(spec, fromDir) + RSC;
    else if (serverPackages.has(spec)) target = serverPackages.get(spec)!;
    // Fail Closed: Server 用に解決していないパッケージを Client 用の解決で黙って読まない
    else throw new Error(`[proofyard] "${spec}" is not available in the server graph (imported from ${fromDir})`);
    const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    code = code.replace(new RegExp(`(["'])${escaped}\\1`, "g"), JSON.stringify(target));
  }
  return code;
}

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx", autoImportJSX: true, tsconfig: { compilerOptions: { jsx: "react-jsx" } } }),
  js: new Bun.Transpiler({ loader: "js" }),
  jsx: new Bun.Transpiler({ loader: "jsx", autoImportJSX: true, tsconfig: { compilerOptions: { jsx: "react-jsx" } } }),
};

const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;

plugin({
  name: "proofyard-poc2",
  setup(build) {
    build.onLoad({ filter: /^(?!.*\/node_modules\/).*\.[cm]?[jt]sx?\?rsc$/ }, async (args) => {
      const path = args.path.slice(0, -RSC.length);
      const source = await Bun.file(path).text();
      const ext = /\.[cm]?jsx?$/.test(path) ? "js" : "ts";
      const loader = (path.endsWith("x") ? `${ext}x` : ext) as keyof typeof transpilers;
      if (!USE_CLIENT.test(source)) {
        return { loader: "js", contents: linkServer(transpilers[loader].transformSync(source), dirname(path)) };
      }
      // Client Component の実装は Server Graph で実行せず、Client Reference だけを export する
      const { exports } = transpilers[loader].scan(source);
      clientModules.set(path, path);
      const id = JSON.stringify(path);
      const lines = exports.map((name) => {
        const binding = name === "default" ? "__default" : name;
        const decl = `const ${binding} = registerClientReference(function () { throw new Error("Client Component " + ${JSON.stringify(name)} + " cannot be called on the server"); }, ${id}, ${JSON.stringify(name)});`;
        return name === "default" ? `${decl}\nexport default __default;` : `${decl}\nexport { ${binding} };`;
      });
      const contents = `import { registerClientReference } from "react-server-dom-turbopack/server";\n${lines.join("\n")}`;
      return { loader: "js", contents: linkServer(contents, dirname(path)) };
    });
  },
});
