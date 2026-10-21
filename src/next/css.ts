// CSS の import（仕様 1.3: スタイルの見た目は検証しない）
// - CSS Modules: Next.js の css-loader を、Next.js がサーバー側で使う設定（exportOnlyLocals。クラス名だけを出す）で動かす。
//   どの層でも同じモジュールを使うので、クラス名は next build と同じ
// - next/font: SWC が書き換えた target.css?{...} の import を、Next.js の next-font-loader → css-loader（同じくサーバー側の設定）で生成する
// - それ以外の CSS: 空のモジュール（Next.js はページに <link rel="stylesheet"> を入れるが、ここでは入れない）
// - Sass / 別のファイルからの composes: Fail Closed
import { dirname } from "node:path";
import * as fs from "node:fs";

const cssLoader = require("next/dist/build/webpack/loaders/css-loader/src").default;
const nextFontLoader = require("next/dist/build/webpack/loaders/next-font-loader").default;
const { getCssModuleLocalIdent } = require("next/dist/build/webpack/config/blocks/css/loaders/getCssModuleLocalIdent");
const { lazyPostCSS } = require("next/dist/build/webpack/config/blocks/css");
const { getSupportedBrowsers } = require("next/dist/build/get-supported-browsers");

export const STYLE_FILE = /\.(?:css|scss|sass)$/;
// SWC の next-transform-font の出力: import brand from 'next/font/local/target.css?{"path":...,"arguments":[...]}'
export const FONT_IMPORT = /'(next\/font\/(?:google|local)\/target\.css)\?((?:[^'\\]|\\.)*)'/g;

type LoaderResult = { code: string; meta?: unknown };
// Next.js のトレース（記録しない）
const span: any = { traceChild: () => span, traceAsyncFn: (fn: () => unknown) => fn(), traceFn: (fn: () => unknown) => fn(), setAttribute() {}, stop() {} };

export function createStyleLoader(projectDir: string, config: any) {
  const supportedBrowsers = getSupportedBrowsers(projectDir, false);
  const postcss = () => lazyPostCSS(projectDir, supportedBrowsers, config.experimental.disablePostcssPresetEnv, config.experimental.useLightningcss);
  // webpack のローダーを 1 つ動かす（必要な分だけのローダーのコンテキスト）
  const run = (loader: Function, resourcePath: string, resourceQuery: string, options: object, input: unknown[]) =>
    new Promise<LoaderResult>((resolve, reject) => {
      loader.apply(
        {
          getOptions: () => options,
          async: () => (error: unknown, code: string, _map: unknown, meta: unknown) => (error ? reject(error) : resolve({ code, meta })),
          currentTraceSpan: span,
          resourcePath,
          resourceQuery,
          context: dirname(resourcePath),
          rootContext: projectDir,
          mode: "production",
          sourceMap: false,
          getResolve: () => async (context: string, request: string) => Bun.resolveSync(request, context),
          resolve: (context: string, request: string, callback: Function) => {
            try {
              callback(null, Bun.resolveSync(request, context));
            } catch (error) {
              callback(error);
            }
          },
          emitWarning: (warning: unknown) => console.warn(warning),
          emitError: (error: unknown) => console.error(error),
          emitFile() {},
          // webpack の入力のファイルシステム（next/font/local がフォントのファイルを読む）
          fs,
          addDependency() {},
          utils: { contextify: (_: string, request: string) => request },
        },
        input,
      );
    });
  // css-loader の出力（esModule: false の CJS）を ESM に（Bun の実行時のプラグインの js は module.exports を default にしない）
  const toModule = (path: string, code: string) => {
    // 別のファイルのクラスを使う composes は、webpack のローダーのリクエストを require する
    if (/\brequire\(/.test(code)) throw new Error(`[proofyard] Unsupported: composes from another file in CSS Modules (${path})`);
    if (!/^module\.exports = /m.test(code)) throw new Error(`[proofyard] unexpected css-loader output for ${path}`);
    return code.replace(/^module\.exports = /m, "export default ");
  };
  // config/blocks/css/loaders/modules.ts の getCssModuleLoader のサーバー側と同じオプション
  const cssModule = async (path: string) => {
    const options = {
      postcss,
      importLoaders: 1,
      esModule: false,
      modules: { exportLocalsConvention: "asIs", exportOnlyLocals: true, mode: "pure", getLocalIdent: getCssModuleLocalIdent },
    };
    return toModule(path, (await run(cssLoader, path, "", options, [fs.readFileSync(path, "utf8")])).code);
  };
  const cache = new Map<string, Promise<string>>();
  const cached = (key: string, make: () => Promise<string>) => {
    let code = cache.get(key);
    if (!code) cache.set(key, (code = make()));
    return code;
  };

  // Bun のプラグインの onLoad の結果
  const style = async (path: string): Promise<{ loader: "js"; contents: string }> => {
    if (!path.endsWith(".css")) throw new Error(`[proofyard] Unsupported: Sass (${path})`);
    if (!/\.module\.css$/.test(path)) return { loader: "js", contents: "" };
    return { loader: "js", contents: await cached(path, () => cssModule(path)) };
  };

  // config/blocks/css/loaders/next-font.ts の getNextFontLoader のサーバー側と同じ（next-font-loader → css-loader）
  const font = (target: string, query: string) =>
    cached(`${target}?${query}`, async () => {
      const resourcePath = require.resolve(target);
      const kind = target.includes("/google/") ? "google" : "local";
      const loaded = await run(
        nextFontLoader,
        resourcePath,
        `?${query}`,
        {
          isDev: false,
          isServer: true,
          assetPrefix: config.assetPrefix,
          deploymentId: config.deploymentId,
          fontLoaderPath: require.resolve(`next/dist/compiled/@next/font/${kind}/loader`),
          postcss,
        },
        [],
      );
      const options = {
        postcss,
        importLoaders: 1,
        esModule: false,
        modules: {
          exportLocalsConvention: "asIs",
          exportOnlyLocals: true,
          mode: "pure",
          getLocalIdent: (_context: unknown, _localIdentName: unknown, exportName: string, _options: unknown, meta: { fontFamilyHash: string }) =>
            `__${exportName}_${meta.fontFamilyHash}`,
        },
        fontLoader: true,
      };
      return toModule(resourcePath, (await run(cssLoader, resourcePath, `?${query}`, options, [loaded.code, null, loaded.meta])).code);
    });

  return { style, font };
}

// JavaScript の ' の文字列リテラルの中身（SWC の出力。JSON の中の ' と \ はエスケープされている）
export const unquote = (literal: string) => literal.replace(/\\(.)/g, "$1");
