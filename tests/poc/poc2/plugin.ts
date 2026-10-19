// PoC 2: 同じ Bun プロセスの中で Server Graph と Client Graph を分ける。
// `bun test --conditions react-server --preload ./tests/poc/poc2/plugin.ts` で使う。
//
// - Server Graph: Bun の通常の読み込み（`react-server` 条件）。テストファイルとアプリの Server 側。
//   bun:test の mock.module がそのまま効く。"use client" のファイルは Client Reference に置き換える。
// - Client Graph: パス末尾に "?client" を付けた別インスタンスとして、このプラグインが読む。
//   パッケージは Bun.build で条件なしの ESM バンドル（client vendor）にまとめる。
//
// ランタイムプラグインだけで分けられない理由（Bun 1.4.2 で実測）:
// - onResolve にはパッケージ名（"react"）が届かない。Bun が先に解決してしまう。CJS の require("react") は届きすらしない
// - onLoad で返した中身は ESM 扱いになり、CJS を返すと exports が空になる
// - Worker にも `--conditions` は個別に渡せない
// Bun.build はプロセスの `--conditions` を引き継がない（実測）ので、client vendor は条件なしで解決される。
import { plugin } from "bun";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

export const CLIENT = "?client";

// "use client" のモジュール ID（ファイルパス）。Client Runtime での解決に使う
export const clientModules = new Set<string>();

// Client Graph から import してよいパッケージ。
// ponytail: 固定リスト。Client Graph が使うパッケージを事前に走査してバンドルの入口を決める形に置き換える
const CLIENT_PACKAGES = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/server",
  "react-dom/client",
  "react-server-dom-turbopack/client",
  "@testing-library/react",
  "@testing-library/user-event",
];

// 入口のスタブはプロジェクト内に置く（node_modules を解決するため。中身は常に同じなので並列でも衝突しない）。
// バンドルの出力はプロセスごとの一時ディレクトリに出す
// ponytail: 毎回ビルドする（約0.1〜0.5秒）。内容ハッシュでキャッシュして再利用できる
const projectRoot = join(import.meta.dir, "../../..");
const vendorDir = join(tmpdir(), `proofyard-client-vendor-${process.pid}`);

// spec -> facade モジュールのパス（名前付き export を持つ ESM）
const clientPackages = await buildClientVendor();

async function buildClientVendor() {
  const srcDir = join(projectRoot, ".proofyard/vendor-src");
  mkdirSync(srcDir, { recursive: true });
  const name = (spec: string) => spec.replaceAll("/", "__");
  for (const spec of CLIENT_PACKAGES) {
    writeFileSync(join(srcDir, `${name(spec)}.js`), `export default require(${JSON.stringify(spec)});\n`);
  }
  const out = join(vendorDir, "out");
  const result = await Bun.build({
    entrypoints: CLIENT_PACKAGES.map((spec) => join(srcDir, `${name(spec)}.js`)),
    outdir: out,
    target: "bun",
    format: "esm",
    splitting: true, // React を1インスタンスにする
  });
  if (!result.success) throw new AggregateError(result.logs, "[proofyard] client vendor build failed");

  // CJS の default を名前付き export に展開する facade。
  // export 名は子プロセスで調べる。このプロセスで評価すると、DOM を用意する前に react-dom/client が
  // `window` の有無を判定して固定してしまうため
  const entryOutputs = result.outputs.filter((o) => o.kind === "entry-point").map((o) => o.path);
  const bundles = CLIENT_PACKAGES.map((spec) => {
    const file = entryOutputs.find((p) => p.endsWith(`/${name(spec)}.js`));
    if (!file) throw new Error(`[proofyard] no bundle output for ${spec}: ${entryOutputs.join(", ")}`);
    return [spec, file] as const;
  });
  const probe = Bun.spawnSync([
    process.execPath,
    "-e",
    `const r = {}; for (const [s, f] of ${JSON.stringify(bundles)}) r[s] = Object.keys((await import(f)).default); console.log(JSON.stringify(r));`,
  ]);
  if (!probe.success) throw new Error(`[proofyard] client vendor probe failed: ${probe.stderr}`);
  const keysOf: Record<string, string[]> = JSON.parse(probe.stdout.toString());
  const map = new Map<string, string>();
  for (const [spec, bundle] of bundles) {
    const keys = keysOf[spec]!.filter((k) => k !== "default" && /^[A-Za-z_$][\w$]*$/.test(k));
    const facade = join(vendorDir, `${name(spec)}.facade.js`);
    writeFileSync(facade, `import m from ${JSON.stringify(bundle)};\nexport const { ${keys.join(", ")} } = m;\n// ESM パッケージを require() すると本体は default の中にある\nexport default "default" in m ? m.default : m;\n`);
    map.set(spec, facade);
  }
  return map;
}

// 静的 import は onResolve を通らないので、Client Graph のソースは import 指定子を解決済みパスに書き換える。
// ponytail: 指定子の文字列置換。同じ文字列リテラルが import 以外にあると巻き込む。AST 変換に置き換える
function linkClient(code: string, fromDir: string): string {
  const specs = new Set(new Bun.Transpiler({ loader: "js" }).scan(code).imports.map((i) => i.path));
  for (const spec of specs) {
    let target: string;
    if (spec.endsWith(CLIENT) || spec.startsWith("node:")) continue;
    else if (spec.startsWith(".") || spec.startsWith("/")) target = Bun.resolveSync(spec, fromDir) + CLIENT;
    else if (clientPackages.has(spec)) target = clientPackages.get(spec)!;
    // Fail Closed: Client 用に解決していないパッケージを Server 用の解決で黙って読まない
    else throw new Error(`[proofyard] "${spec}" is not available in the client graph (imported from ${fromDir})`);
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

function loaderOf(path: string) {
  const ext = /\.[cm]?jsx?$/.test(path) ? "js" : "ts";
  return (path.endsWith("x") ? `${ext}x` : ext) as keyof typeof transpilers;
}

const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;

// Server Graph で "use client" のモジュールを読んだとき、実装の代わりに返すモジュール
function clientReferenceModule(path: string, source: string): string {
  clientModules.add(path);
  const id = JSON.stringify(path);
  const lines = transpilers[loaderOf(path)].scan(source).exports.map((name) => {
    const binding = name === "default" ? "__default" : name;
    const decl = `const ${binding} = registerClientReference(function () { throw new Error("Client Component " + ${JSON.stringify(name)} + " cannot be called on the server"); }, ${id}, ${JSON.stringify(name)});`;
    return name === "default" ? `${decl}\nexport default __default;` : `${decl}\nexport { ${binding} };`;
  });
  return `import { registerClientReference } from "react-server-dom-turbopack/server";\n${lines.join("\n")}`;
}

plugin({
  name: "proofyard-poc2",
  setup(build) {
    // Server Graph のアプリソース（node_modules の CJS は返せないので対象外）
    // ponytail: node_modules 内の "use client" は検出できず、実装がそのまま Server Graph で動く。要対応
    build.onLoad({ filter: /^(?!.*\/node_modules\/).*\.[cm]?[jt]sx?$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (USE_CLIENT.test(source)) return { loader: "js", contents: clientReferenceModule(args.path, source) };
      return { loader: loaderOf(args.path), contents: source };
    });

    // Client Graph のアプリソース
    build.onLoad({ filter: /^(?!.*\/node_modules\/).*\.[cm]?[jt]sx?\?client$/ }, (args) => {
      const path = args.path.slice(0, -CLIENT.length);
      const source = readFileSync(path, "utf8");
      return { loader: "js", contents: linkClient(transpilers[loaderOf(path)].transformSync(source), dirname(path)) };
    });
  },
});
