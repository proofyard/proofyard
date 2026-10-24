// CSS の import（仕様 1.3: スタイルの見た目は検証しない）
// - CSS Modules: Next.js の css-loader を、Next.js がサーバー側で使う設定（exportOnlyLocals。クラス名だけを出す）で動かす。
//   どの層でも同じモジュールを使うので、クラス名は next build と同じ
// - next/font: SWC が書き換えた target.css?{...} の import を、Next.js の next-font-loader → css-loader（同じくサーバー側の設定）で生成する
// - それ以外の CSS: 空のモジュール（Next.js はページに <link rel="stylesheet"> を入れるが、ここでは入れない）
// - Sass（.scss / .sass）: Next.js と同じく、同梱の sass-loader（アプリの sass を使う）で CSS にしてから同じように扱う
// - 別のファイルからの composes: css-loader が出す require を、そのファイル（同じく CSS Modules として読む）の import にする
import { dirname } from "node:path";
import * as fs from "node:fs";

const cssLoader = require("next/dist/build/webpack/loaders/css-loader/src").default;
const sassLoader = require("next/dist/compiled/sass-loader");
const nextFontLoader = require("next/dist/build/webpack/loaders/next-font-loader").default;
const { getCssModuleLocalIdent } = require("next/dist/build/webpack/config/blocks/css/loaders/getCssModuleLocalIdent");
const { lazyPostCSS } = require("next/dist/build/webpack/config/blocks/css");
const { getSupportedBrowsers } = require("next/dist/build/get-supported-browsers");

export const STYLE_FILE = /\.(?:css|scss|sass)$/;
const SASS_FILE = /\.(?:scss|sass)$/;
const CSS_MODULE_FILE = /\.module\.(?:css|scss|sass)$/;
// SWC の next-transform-font の出力: import brand from 'next/font/local/target.css?{"path":...,"arguments":[...]}'
export const FONT_IMPORT = /'(next\/font\/(?:google|local)\/target\.css)\?((?:[^'\\]|\\.)*)'/g;

// css-loader の出力の require のリクエストに入る、このローダーの名前
const CSS_MODULE_REQUEST = "proofyard-css-module";

type LoaderResult = { code: string; meta?: unknown };
// Next.js のトレース（記録しない）
const span: any = { traceChild: () => span, traceAsyncFn: (fn: () => unknown) => fn(), traceFn: (fn: () => unknown) => fn(), setAttribute() {}, stop() {} };

export function createStyleLoader(projectDir: string, config: any) {
  const supportedBrowsers = getSupportedBrowsers(projectDir, false);
  const postcss = () => lazyPostCSS(projectDir, supportedBrowsers, config.experimental.disablePostcssPresetEnv, config.experimental.useLightningcss);
  // webpack のローダーを 1 つ動かす（必要な分だけのローダーのコンテキスト）
  // emitted: ローダーが出力したファイル（next-font-loader のフォント。static/media/<hash>[.p].<ext>）
  const run = (loader: Function, resourcePath: string, resourceQuery: string, options: object, input: unknown[], emitted?: Map<string, Buffer>) =>
    new Promise<LoaderResult>((resolve, reject) => {
      // async 関数のローダー（sass-loader）は、this.async() の前の例外を Promise で返す
      const returned = loader.apply(
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
          emitFile: (name: string, content: Buffer) => emitted?.set(name, content),
          // webpack の入力のファイルシステム（next/font/local がフォントのファイルを読む）
          fs,
          addDependency() {},
          // css-loader は composes の先のファイルを、このローダーを通すリクエストにする（下の toModule で import にする）
          loaders: [{ request: CSS_MODULE_REQUEST }],
          loaderIndex: 0,
          utils: { contextify: (_: string, request: string) => request },
          // sass-loader の @warn / @debug（webpack はビルドの警告にする）
          getLogger: () => ({ warn: console.warn, error: console.error, info() {}, log() {}, debug() {}, trace() {} }),
        },
        input,
      );
      if (returned instanceof Promise) returned.catch(reject);
    });
  // css-loader の出力（esModule: false の CJS）を ESM に（Bun の実行時のプラグインの js は module.exports を default にしない）
  const toModule = (path: string, code: string) => {
    // 別のファイルのクラスを使う composes: var ___CSS_LOADER_ICSS_IMPORT_0___ = require("-!<このローダー>!/abs/other.module.css");
    code = code.replace(/^var (\w+) = require\(("(?:[^"\\]|\\.)*")\);$/gm, (line, name: string, literal: string) => {
      const request: string = JSON.parse(literal);
      const prefix = `-!${CSS_MODULE_REQUEST}!`;
      const file = request.startsWith(prefix) ? request.slice(prefix.length) : undefined;
      if (!file || !CSS_MODULE_FILE.test(file)) throw new Error(`[proofyard] Unsupported: composes from ${file ?? request} in ${path} (only CSS Modules files)`);
      return `import ${name} from ${JSON.stringify(file)};`;
    });
    if (/\brequire\(/.test(code) || !/^module\.exports = /m.test(code)) throw new Error(`[proofyard] unexpected css-loader output for ${path}`);
    return code.replace(/^module\.exports = /m, "export default ");
  };
  // config/blocks/css/loaders/modules.ts の getCssModuleLoader のサーバー側と同じオプション
  // config/blocks/css/index.ts の sassPreprocessors と同じオプション（その後の resolve-url-loader は url() を直すだけなので使わない）
  const { prependData, additionalData, implementation, ...sassOptions } = config.sassOptions ?? {};
  const sass = { implementation, sourceMap: true, sassOptions, additionalData: prependData || additionalData };
  const cssModule = async (path: string) => {
    const preprocessors = SASS_FILE.test(path) ? 2 : 0;
    const source = fs.readFileSync(path, "utf8");
    const css = preprocessors ? (await run(sassLoader, path, "", sass, [source])).code : source;
    const options = {
      postcss,
      importLoaders: 1 + preprocessors,
      esModule: false,
      modules: { exportLocalsConvention: "asIs", exportOnlyLocals: true, mode: "pure", getLocalIdent: getCssModuleLocalIdent },
    };
    return toModule(path, (await run(cssLoader, path, "", options, [css])).code);
  };
  const cache = new Map<string, Promise<unknown>>();
  const cached = <T>(key: string, make: () => Promise<T>) => {
    let result = cache.get(key) as Promise<T> | undefined;
    if (!result) cache.set(key, (result = make()));
    return result;
  };

  // Bun のプラグインの onLoad の結果
  const style = async (path: string): Promise<{ loader: "js"; contents: string }> => {
    if (!CSS_MODULE_FILE.test(path)) return { loader: "js", contents: "" };
    return { loader: "js", contents: await cached(path, () => cssModule(path)) };
  };

  // config/blocks/css/loaders/next-font.ts の getNextFontLoader のサーバー側と同じ（next-font-loader → css-loader）。
  // files: クライアント側の next-font-loader が出力したフォントのファイル（名前 → 中身）
  const font = (target: string, query: string) =>
    cached(`${target}?${query}`, async (): Promise<{ code: string; files: Map<string, Buffer> }> => {
      const files = new Map<string, Buffer>();
      const resourcePath = require.resolve(target);
      const kind = target.includes("/google/") ? "google" : "local";
      const fontOptions = (isServer: boolean) => ({
        isDev: false,
        isServer,
        assetPrefix: config.assetPrefix,
        deploymentId: config.deploymentId,
        fontLoaderPath: require.resolve(`next/dist/compiled/@next/font/${kind}/loader`),
        postcss,
      });
      const loaded = await run(nextFontLoader, resourcePath, `?${query}`, fontOptions(true), []);
      // ファイルを出力するのはクライアント側の設定だけ（next-font-loader の emitFontFile）。同じ設定で動かしてファイルだけ受け取る
      await run(nextFontLoader, resourcePath, `?${query}`, fontOptions(false), [], files);
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
      return { code: toModule(resourcePath, (await run(cssLoader, resourcePath, `?${query}`, options, [loaded.code, null, loaded.meta])).code), files };
    });

  return { style, font };
}

// JavaScript の ' の文字列リテラルの中身（SWC の出力。JSON の中の ' と \ はエスケープされている）
export const unquote = (literal: string) => literal.replace(/\\(.)/g, "$1");
