/* oxlint-disable unicorn/prefer-module -- Next.js 同梱のローダーを同期で読み、解決する（package.json の依存にない内部モジュール） */
import * as fs from "node:fs";
// CSS の import（仕様 1.3: スタイルの見た目は検証しない）
// - CSS Modules: Next.js の css-loader を、Next.js がサーバー側で使う設定（exportOnlyLocals。クラス名だけを出す）で動かす。
//   どの層でも同じモジュールを使うので、クラス名は next build と同じ
// - next/font: SWC が書き換えた target.css?{...} の import を、Next.js の next-font-loader → css-loader（同じくサーバー側の設定）で生成する
// - それ以外の CSS: 空のモジュール（Next.js はページに <link rel="stylesheet"> を入れるが、ここでは入れない）
// - Sass（.scss / .sass）: Next.js と同じく、同梱の sass-loader（アプリの sass を使う）で CSS にしてから同じように扱う
// - 別のファイルからの composes: css-loader が出す require を、そのファイル（同じく CSS Modules として読む）の import にする
import nodePath from "node:path";

const cssLoader =
  require("next/dist/build/webpack/loaders/css-loader/src").default;
const sassLoader = require("next/dist/compiled/sass-loader");
const nextFontLoader =
  require("next/dist/build/webpack/loaders/next-font-loader").default;
const {
  getCssModuleLocalIdent,
} = require("next/dist/build/webpack/config/blocks/css/loaders/getCssModuleLocalIdent");
const { lazyPostCSS } = require("next/dist/build/webpack/config/blocks/css");
const {
  getSupportedBrowsers,
} = require("next/dist/build/get-supported-browsers");

// oxlint-disable-next-line require-unicode-regexp -- Bun のプラグインの filter（ネイティブの照合）に渡すので u を付けない
export const STYLE_FILE = /\.(?:css|scss|sass)$/;
const SASS_FILE = /\.(?:scss|sass)$/u;
const CSS_MODULE_FILE = /\.module\.(?:css|scss|sass)$/u;
// SWC の next-transform-font の出力: import brand from 'next/font/local/target.css?{"path":...,"arguments":[...]}'
export const FONT_IMPORT =
  /'(?<target>next\/font\/(?:google|local)\/target\.css)\?(?<query>(?:[^'\\]|\\.)*)'/gu;

// css-loader の出力の require のリクエストに入る、このローダーの名前
const CSS_MODULE_REQUEST = "proofyard-css-module";

interface LoaderResult {
  code: string;
  meta?: unknown;
}
// Next.js のトレース（記録しない）
const span: Record<string, unknown> = {
  setAttribute() {
    // 記録しない
  },
  stop() {
    // 記録しない
  },
  traceAsyncFn: (fn: () => unknown) => fn(),
  traceChild: () => span,
  traceFn: (fn: () => unknown) => fn(),
};

// css-loader の出力（esModule: false の CJS）を ESM に（Bun の実行時のプラグインの js は module.exports を default にしない）
const toModule = (path: string, code: string) => {
  // 別のファイルのクラスを使う composes: var ___CSS_LOADER_ICSS_IMPORT_0___ = require("-!<このローダー>!/abs/other.module.css");
  const imported = code.replaceAll(
    /^var (?<name>\w+) = require\((?<literal>"(?:[^"\\]|\\.)*")\);$/gmu,
    (line, name: string, literal: string) => {
      const request: string = JSON.parse(literal);
      const prefix = `-!${CSS_MODULE_REQUEST}!`;
      const file = request.startsWith(prefix)
        ? request.slice(prefix.length)
        : undefined;
      if (!file || !CSS_MODULE_FILE.test(file)) {
        throw new Error(
          `[proofyard] Unsupported: composes from ${file ?? request} in ${path} (only CSS Modules files)`
        );
      }
      return `import ${name} from ${JSON.stringify(file)};`;
    }
  );
  if (
    /\brequire\(/u.test(imported) ||
    !/^module\.exports = /mu.test(imported)
  ) {
    throw new Error(`[proofyard] unexpected css-loader output for ${path}`);
  }
  return imported.replace(/^module\.exports = /mu, "export default ");
};

// oxlint-disable-next-line typescript/no-explicit-any -- Next.js の内部の設定（next.config を読み込んだもの。型を合わせない）
export const createStyleLoader = (projectDir: string, config: any) => {
  const supportedBrowsers = getSupportedBrowsers(projectDir, false);
  const postcss = () =>
    lazyPostCSS(
      projectDir,
      supportedBrowsers,
      config.experimental.disablePostcssPresetEnv,
      config.experimental.useLightningcss
    );
  // webpack のローダーを 1 つ動かす（必要な分だけのローダーのコンテキスト）
  // emitted: ローダーが出力したファイル（next-font-loader のフォント。static/media/<hash>[.p].<ext>）
  const run = (
    loader: (...args: unknown[]) => unknown,
    resourcePath: string,
    resourceQuery: string,
    options: object,
    input: unknown[],
    emitted?: Map<string, Buffer>
  ) =>
    // oxlint-disable-next-line promise/avoid-new -- コールバックのローダーを包む（同期の例外も reject にする）
    new Promise<LoaderResult>((resolve, reject) => {
      // async 関数のローダー（sass-loader）は、this.async() の前の例外を Promise で返す
      const returned = loader.apply(
        {
          addDependency() {
            // 依存は記録しない
          },
          async:
            () =>
            (error: unknown, code: string, _map: unknown, meta: unknown) =>
              error ? reject(error) : resolve({ code, meta }),
          context: nodePath.dirname(resourcePath),
          currentTraceSpan: span,
          emitError: (error: unknown) => console.error(error),
          emitFile: (name: string, content: Buffer) =>
            emitted?.set(name, content),
          emitWarning: (warning: unknown) => console.warn(warning),
          // webpack の入力のファイルシステム（next/font/local がフォントのファイルを読む）
          fs,
          // sass-loader の @warn / @debug（webpack はビルドの警告にする）
          getLogger: () => ({
            debug() {
              // 出さない
            },
            error: console.error,
            info() {
              // 出さない
            },
            log() {
              // 出さない
            },
            trace() {
              // 出さない
            },
            warn: console.warn,
          }),
          getOptions: () => options,
          // oxlint-disable-next-line require-await -- 解決の失敗を reject で返す（webpack の getResolve と同じ）
          getResolve: () => async (context: string, request: string) =>
            Bun.resolveSync(request, context),
          loaderIndex: 0,
          // css-loader は composes の先のファイルを、このローダーを通すリクエストにする（上の toModule で import にする）
          loaders: [{ request: CSS_MODULE_REQUEST }],
          mode: "production",
          /* oxlint-disable promise/prefer-await-to-callbacks, node/callback-return -- webpack のローダーの resolve はコールバックの API */
          resolve: (
            context: string,
            request: string,
            callback: (error: unknown, result?: string) => void
          ) => {
            try {
              callback(null, Bun.resolveSync(request, context));
            } catch (error) {
              callback(error);
            }
          },
          /* oxlint-enable promise/prefer-await-to-callbacks, node/callback-return */
          resourcePath,
          resourceQuery,
          rootContext: projectDir,
          sourceMap: false,
          utils: { contextify: (_: string, request: string) => request },
        },
        input
      );
      if (returned instanceof Promise) {
        returned.catch(reject);
      }
    });
  // config/blocks/css/loaders/modules.ts の getCssModuleLoader のサーバー側と同じオプション
  // config/blocks/css/index.ts の sassPreprocessors と同じオプション（その後の resolve-url-loader は url() を直すだけなので使わない）
  const { prependData, additionalData, implementation, ...sassOptions } =
    config.sassOptions ?? {};
  const sass = {
    additionalData: prependData || additionalData,
    implementation,
    sassOptions,
    sourceMap: true,
  };
  const cssModule = async (path: string) => {
    const preprocessors = SASS_FILE.test(path) ? 2 : 0;
    const source = fs.readFileSync(path, "utf-8");
    let css = source;
    if (preprocessors) {
      ({ code: css } = await run(sassLoader, path, "", sass, [source]));
    }
    const options = {
      esModule: false,
      importLoaders: 1 + preprocessors,
      modules: {
        exportLocalsConvention: "asIs",
        exportOnlyLocals: true,
        getLocalIdent: getCssModuleLocalIdent,
        mode: "pure",
      },
      postcss,
    };
    const { code } = await run(cssLoader, path, "", options, [css]);
    return toModule(path, code);
  };
  const cache = new Map<string, Promise<unknown>>();
  const cached = <T>(key: string, make: () => Promise<T>) => {
    let result = cache.get(key) as Promise<T> | undefined;
    if (!result) {
      cache.set(key, (result = make()));
    }
    return result;
  };

  // Bun のプラグインの onLoad の結果
  const style = async (
    path: string
  ): Promise<{ loader: "js"; contents: string }> => {
    if (!CSS_MODULE_FILE.test(path)) {
      return { contents: "", loader: "js" };
    }
    return {
      contents: await cached(path, () => cssModule(path)),
      loader: "js",
    };
  };

  // config/blocks/css/loaders/next-font.ts の getNextFontLoader のサーバー側と同じ（next-font-loader → css-loader）。
  // files: クライアント側の next-font-loader が出力したフォントのファイル（名前 → 中身）
  const font = (target: string, query: string) =>
    cached(
      `${target}?${query}`,
      async (): Promise<{ code: string; files: Map<string, Buffer> }> => {
        const files = new Map<string, Buffer>();
        const resourcePath = require.resolve(target);
        const kind = target.includes("/google/") ? "google" : "local";
        const fontOptions = (isServer: boolean) => ({
          assetPrefix: config.assetPrefix,
          deploymentId: config.deploymentId,
          fontLoaderPath: require.resolve(
            `next/dist/compiled/@next/font/${kind}/loader`
          ),
          isDev: false,
          isServer,
          postcss,
        });
        const loaded = await run(
          nextFontLoader,
          resourcePath,
          `?${query}`,
          fontOptions(true),
          []
        );
        // ファイルを出力するのはクライアント側の設定だけ（next-font-loader の emitFontFile）。同じ設定で動かしてファイルだけ受け取る
        await run(
          nextFontLoader,
          resourcePath,
          `?${query}`,
          fontOptions(false),
          [],
          files
        );
        const options = {
          esModule: false,
          fontLoader: true,
          importLoaders: 1,
          modules: {
            exportLocalsConvention: "asIs",
            exportOnlyLocals: true,
            getLocalIdent: (
              _context: unknown,
              _localIdentName: unknown,
              exportName: string,
              _options: unknown,
              meta: { fontFamilyHash: string }
            ) => `__${exportName}_${meta.fontFamilyHash}`,
            mode: "pure",
          },
          postcss,
        };
        const { code } = await run(
          cssLoader,
          resourcePath,
          `?${query}`,
          options,
          [loaded.code, null, loaded.meta]
        );
        return { code: toModule(resourcePath, code), files };
      }
    );

  return { font, style };
};

// JavaScript の ' の文字列リテラルの中身（SWC の出力。JSON の中の ' と \ はエスケープされている）
export const unquote = (literal: string) =>
  literal.replaceAll(/\\(?<char>.)/gu, "$<char>");
