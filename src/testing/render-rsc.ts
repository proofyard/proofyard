/* oxlint-disable typescript/no-explicit-any -- Flight / React 内部の値と globalThis の型のない境界を扱う */
// RSC Mode（仕様 4.1）: Server Components を React 公式の RSC Renderer で描画し、Flight でシリアライズ・デシリアライズして、
// 得られた React ツリーの構造を検査する。DOM は作らず、Client Components は実行しない（Client Reference のまま残す）。
import { clientExports, clientIds, esmClientIds } from "../next/layers";

const REACT_ELEMENT = Symbol.for("react.transitional.element");
const REACT_LAZY = Symbol.for("react.lazy");
const REACT_FRAGMENT = Symbol.for("react.fragment");
const REACT_SUSPENSE = Symbol.for("react.suspense");

// デコード時の Client Reference のモジュール id。本物の Client Component の代わりに目印のモジュールを返す
const PLACEHOLDER_PREFIX = "proofyard-client-reference:";
const CLIENT_REFERENCE = Symbol("proofyard.clientReference");

export interface ClientReference {
  // "use client" モジュールのパス
  id: string;
  // export 名
  name: string;
}
export interface RSCHostElement {
  type: string;
  props: Record<string, unknown>;
  children: RSCNode[];
}
export interface RSCClientElement {
  type: ClientReference;
  props: Record<string, unknown>;
  children: RSCNode[];
}
export type RSCElement = RSCHostElement | RSCClientElement;
export type RSCNode = RSCElement | string;
export type TextMatcher = string | RegExp;

// Server Function の参照（"use server"）。React の Server Reference と同じ $$id / $$bound を持ち、呼ぶとエラー
const SERVER_PLACEHOLDER_PREFIX = "proofyard-server-reference:";
export type ServerReference = ((...args: unknown[]) => never) & {
  $$id: string;
  $$bound: unknown[] | null;
};
const serverReference = (
  id: string,
  bound: unknown[] | null
): ServerReference => {
  const reference = (() => {
    throw new Error("[proofyard] Server Functions are not called in renderRSC");
  }) as unknown as ServerReference;
  Object.assign(reference, {
    $$bound: bound,
    $$id: id,
    // Flight のデコードは bound 引数を .bind で付ける
    bind: (_this: unknown, ...args: unknown[]) =>
      serverReference(id, [...(bound ?? []), ...args]),
  });
  return reference;
};

const placeholders = new Map<string, Record<string, unknown>>();
(globalThis as any)[Symbol.for("proofyard.clientReferencePlaceholder")] = (
  id: string
) => {
  if (id.startsWith(SERVER_PLACEHOLDER_PREFIX)) {
    return serverReference(id.slice(SERVER_PLACEHOLDER_PREFIX.length), null);
  }
  if (!id.startsWith(PLACEHOLDER_PREFIX)) {
    return;
  }
  const moduleId = id.slice(PLACEHOLDER_PREFIX.length);
  let placeholderModule = placeholders.get(moduleId);
  if (!placeholderModule) {
    const placeholder = (name: string) =>
      Object.assign(
        () => {
          throw new Error(
            "[proofyard] Client Components are not executed in renderRSC"
          );
        },
        { [CLIENT_REFERENCE]: { id: moduleId, name } satisfies ClientReference }
      );
    placeholderModule = Object.fromEntries(
      (clientExports.get(moduleId) ?? []).map((name) => [
        name,
        placeholder(name),
      ])
    );
    // CommonJS の default の import は、createClientModuleProxy と同じく名前が "" の参照（React は __esModule を見て default を読む）
    if (!esmClientIds.has(moduleId)) {
      Object.assign(placeholderModule, {
        __esModule: true,
        default: placeholder(""),
      });
    }
    placeholders.set(moduleId, placeholderModule);
  }
  return placeholderModule;
};

const flightEntry = (id: string) => ({
  async: false,
  chunks: [],
  id,
  name: "*",
});

// まだ届いていない Flight のチャンク（中の thenable を待てば進む）
class Pending {
  readonly thenable: PromiseLike<unknown>;
  constructor(thenable: PromiseLike<unknown>) {
    this.thenable = thenable;
  }
}

// PromiseLike が成功しても失敗しても解決する Promise
const settle = (thenable: PromiseLike<unknown>) =>
  // oxlint-disable-next-line promise/avoid-new -- PromiseLike（React の thenable）を Promise にする
  new Promise((resolve) => {
    // oxlint-disable-next-line promise/catch-or-return, promise/prefer-catch -- React の thenable は then だけを持つ（catch がない）
    thenable.then(resolve, resolve);
  });

const noop = () => {
  // 何もしない
};

// React.lazy（Flight のチャンクは未到着なら thenable を投げる）
const readLazy = (lazy: any): unknown => {
  try {
    return lazy._init(lazy._payload);
  } catch (error: any) {
    if (typeof error?.then === "function") {
      throw new Pending(error);
    }
    throw error;
  }
};

// Flight のチャンク（React の thenable。then を呼ぶと届いているモデルが初期化される）
const readThenable = (thenable: any): unknown => {
  if (thenable.status !== "fulfilled" && thenable.status !== "rejected") {
    // oxlint-disable-next-line promise/catch-or-return, promise/prefer-catch -- React の thenable は then だけを持つ（catch がない）
    thenable.then(noop, noop);
  }
  if (thenable.status === "fulfilled") {
    return thenable.value;
  }
  if (thenable.status === "rejected") {
    throw thenable.reason;
  }
  throw new Pending(thenable);
};

const isEmpty = (node: unknown) =>
  node === null || node === undefined || typeof node === "boolean";
const isText = (node: unknown) =>
  typeof node === "string" ||
  typeof node === "number" ||
  typeof node === "bigint";
const elementType = (node: any) =>
  node.type?.$$typeof === REACT_LAZY ? readLazy(node.type) : node.type;

// 届いているチャンクだけで、いまのツリーを作る（同期）。
// 未到着のチャンクに当たったら、一番近い Suspense の fallback を表示し、その thenable を pending に入れる。
// Suspense の外で未到着なら Pending を投げる（シェルが未完成）
const snapshot = (node: any, pending: Set<PromiseLike<unknown>>): RSCNode[] => {
  if (isEmpty(node)) {
    return [];
  }
  if (isText(node)) {
    return [String(node)];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => snapshot(child, pending));
  }
  if (node.$$typeof === REACT_LAZY) {
    return snapshot(readLazy(node), pending);
  }
  if (typeof node.then === "function") {
    return snapshot(readThenable(node), pending);
  }
  if (node.$$typeof === REACT_ELEMENT) {
    const type = elementType(node);
    const { children, fallback, ...props } = node.props as Record<
      string,
      unknown
    >;
    if (type === REACT_SUSPENSE) {
      try {
        return snapshot(children, pending);
      } catch (error) {
        if (!(error instanceof Pending)) {
          throw error;
        }
        pending.add(error.thenable);
        return snapshot(fallback, pending);
      }
    }
    if (fallback !== undefined) {
      props.fallback = fallback;
    }
    if (type === REACT_FRAGMENT) {
      return snapshot(children, pending);
    }
    if (typeof type === "string") {
      // oxlint-disable-next-line sort-keys -- 利用者に返すノードのキー順（type → props → children）を保つ
      return [{ type, props, children: snapshot(children, pending) }];
    }
    const reference = type?.[CLIENT_REFERENCE] as ClientReference | undefined;
    if (reference) {
      return [
        // oxlint-disable-next-line sort-keys -- 利用者に返すノードのキー順（type → props → children）を保つ
        { type: reference, props, children: snapshot(children, pending) },
      ];
    }
    throw new Error(
      `[proofyard] Unsupported element type in the RSC payload: ${String(type?.toString?.() ?? type)}`
    );
  }
  throw new Error(
    `[proofyard] Unsupported value in the RSC payload: ${String(node)}`
  );
};

const textOf = (node: RSCNode): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const normalize = (text: string) => text.replaceAll(/\s+/gu, " ").trim();
const matches = (node: RSCNode, matcher: TextMatcher) => {
  const text = normalize(textOf(node));
  return typeof matcher === "string" ? text === matcher : matcher.test(text);
};
// oxlint-disable-next-line func-style -- ジェネレーターはアロー関数にできない
function* elements(nodes: RSCNode[]): Generator<RSCElement> {
  for (const node of nodes) {
    if (typeof node !== "string") {
      yield node;
      yield* elements(node.children);
    }
  }
}
const isClient = (element: RSCElement): element is RSCClientElement =>
  typeof element.type !== "string";

export interface WaitOptions {
  timeout?: number;
}

export interface RenderRSCResult {
  // いまのツリー（Fragment は展開済み。待っている Suspense は fallback）
  readonly root: RSCNode[];
  // ツリー全体のテキスト
  text: () => string;
  queryAllByText: (matcher: TextMatcher) => RSCElement[];
  queryByText: (matcher: TextMatcher) => RSCElement | null;
  getAllByText: (matcher: TextMatcher) => RSCElement[];
  getByText: (matcher: TextMatcher) => RSCElement;
  // 見つかるまで（Flight のチャンクが届くたびに）待つ
  findAllByText: (
    matcher: TextMatcher,
    options?: WaitOptions
  ) => Promise<RSCElement[]>;
  findByText: (
    matcher: TextMatcher,
    options?: WaitOptions
  ) => Promise<RSCElement>;
  // Client Reference（export 名、または "use client" モジュールから import したもの）
  getAllClientReferences: (component?: string | object) => RSCClientElement[];
  getClientReference: (component: string | object) => RSCClientElement;
  // すべての Suspense が解決するまで待つ
  waitForComplete: (options?: WaitOptions) => Promise<void>;
}

const DEFAULT_TIMEOUT = 1000;

const dump = (nodes: RSCNode[]) => normalize(nodes.map(textOf).join(""));

const queryAll = (nodes: RSCNode[], matcher: TextMatcher) =>
  // テキストが一致する要素のうち、一番内側のもの
  [...elements(nodes)].filter(
    (el) =>
      matches(el, matcher) &&
      !el.children.some((c) => typeof c !== "string" && matches(c, matcher))
  );
const getAll = (nodes: RSCNode[], matcher: TextMatcher) => {
  const found = queryAll(nodes, matcher);
  if (!found.length) {
    throw new Error(
      `[proofyard] Unable to find an element with the text: ${matcher}\n\n${dump(nodes)}`
    );
  }
  return found;
};
const single = <T>(found: T[], what: string, nodes: RSCNode[]): T => {
  if (found.length !== 1) {
    throw new Error(
      `[proofyard] Found ${found.length} elements for ${what} (expected 1)\n\n${dump(nodes)}`
    );
  }
  return found[0] as T;
};

const createResult = (
  rootValue: unknown,
  serverError: (error: unknown) => unknown
): RenderRSCResult => {
  const take = () => {
    const pending = new Set<PromiseLike<unknown>>();
    try {
      return { nodes: snapshot(rootValue, pending), pending };
    } catch (error) {
      throw serverError(error);
    }
  };
  const current = () => take().nodes;
  // pending のどれかが進むか、期限まで待って fn をやり直す
  const retry = async <T>(
    fn: (nodes: RSCNode[]) => T,
    timeout = DEFAULT_TIMEOUT
  ): Promise<T> => {
    const deadline = performance.now() + timeout;
    for (;;) {
      const { nodes, pending } = take();
      try {
        return fn(nodes);
      } catch (error) {
        const remaining = deadline - performance.now();
        if (!pending.size || remaining <= 0) {
          throw error;
        }
        // oxlint-disable-next-line no-await-in-loop -- チャンクが進むのを待ってからやり直す（順番に待つ必要がある）
        await Promise.race([...[...pending].map(settle), Bun.sleep(remaining)]);
      }
    }
  };
  const getAllClientReferences = (component?: string | object) => {
    const match = (ref: ClientReference) => {
      if (component === undefined) {
        return true;
      }
      if (typeof component === "string") {
        return ref.name === component;
      }
      // "use client" モジュールを import したもの（registerClientReference の $$id は "パス#export名"）
      return (component as { $$id?: string }).$$id === `${ref.id}#${ref.name}`;
    };
    return [...elements(current())]
      .filter(isClient)
      .filter((el) => match(el.type));
  };
  return {
    findAllByText: (matcher, options) =>
      retry((nodes) => getAll(nodes, matcher), options?.timeout),
    findByText: (matcher, options) =>
      retry(
        (nodes) =>
          single(getAll(nodes, matcher), `the text: ${matcher}`, nodes),
        options?.timeout
      ),
    getAllByText: (matcher) => getAll(current(), matcher),
    getAllClientReferences,
    getByText: (matcher) => {
      const nodes = current();
      return single(getAll(nodes, matcher), `the text: ${matcher}`, nodes);
    },
    getClientReference: (component) =>
      single(
        getAllClientReferences(component),
        `the client reference: ${typeof component === "string" ? component : (component as any).$$id}`,
        current()
      ),
    queryAllByText: (matcher) => queryAll(current(), matcher),
    queryByText: (matcher) => {
      const nodes = current();
      const found = queryAll(nodes, matcher);
      return found.length ? single(found, `the text: ${matcher}`, nodes) : null;
    },
    get root() {
      return current();
    },
    text: () => dump(current()),
    waitForComplete: (options) =>
      retry((nodes) => {
        if (take().pending.size) {
          throw new Error(
            `[proofyard] Suspense boundaries are still pending\n\n${dump(nodes)}`
          );
        }
      }, options?.timeout),
  };
};

// Server Components を React 公式の RSC Renderer で Flight にする（Client Reference の id は "use client" モジュールのパス）。
// serverError: デコード側で受け取ったエラーを、サーバー側の元のエラーに戻す（本番の Flight では digest だけになるので onError の digest で対応付ける）
export const renderFlight = (model: unknown) => {
  // oxlint-disable-next-line node/global-require, unicorn/prefer-module -- 実行時に Next.js 同梱のものを同期で解決する（package.json の依存にない）
  const { renderToReadableStream } = require("react-server-dom-webpack/server");
  // digest → 元のエラー
  const errors = new Map<string, unknown>();
  const stream: ReadableStream<Uint8Array> = renderToReadableStream(
    model,
    Object.fromEntries([...clientIds].map((id) => [id, flightEntry(id)])),
    {
      onError: (error: unknown) => {
        const digest = `proofyard-${errors.size}`;
        errors.set(digest, error);
        return digest;
      },
    }
  );
  const serverError = (error: unknown) =>
    errors.get((error as { digest?: string })?.digest ?? "") ?? error;
  return { serverError, stream };
};

// Server Components を描画し、Flight を往復させた React ツリーを返す（シェルが揃った時点。待っている Suspense は fallback）。
// 描画中のエラーはサーバー側の元のエラーとして投げる。
export const renderRSC = async (model: unknown): Promise<RenderRSCResult> => {
  const {
    createFromReadableStream,
    // oxlint-disable-next-line node/global-require, unicorn/prefer-module -- 実行時に Next.js 同梱のものを同期で解決する（package.json の依存にない）
  } = require("react-server-dom-webpack/client");
  const { stream, serverError } = renderFlight(model);
  // Next.js 内蔵の Flight クライアントは globalThis.__next_require__ でモジュールを読む
  (globalThis as any).__next_require__ = (id: string) =>
    (globalThis as any).__proofyardNextRequire(id);
  const response = createFromReadableStream(stream, {
    serverConsumerManifest: {
      moduleLoading: null,
      moduleMap: Object.fromEntries(
        [...clientIds].map((id) => [
          id,
          { "*": flightEntry(PLACEHOLDER_PREFIX + id) },
        ])
      ),
      // Server Function の id はハッシュで事前に分からないので、どの id も目印のモジュールにする
      serverModuleMap: new Proxy(
        {},
        {
          get: (_, id) =>
            typeof id === "string"
              ? { chunks: [], id: SERVER_PLACEHOLDER_PREFIX + id, name: "" }
              : undefined,
        }
      ),
    },
  });
  let rootValue: unknown;
  try {
    rootValue = await response;
  } catch (error) {
    throw serverError(error);
  }
  const result = createResult(rootValue, serverError);
  // シェル（Suspense の外）が揃うまで待つ
  for (;;) {
    try {
      // oxlint-disable-next-line no-unused-expressions -- root の getter で描画を試す（未到着なら Pending を投げる）
      result.root;
      return result;
    } catch (error) {
      if (!(error instanceof Pending)) {
        throw error;
      }
      // oxlint-disable-next-line no-await-in-loop -- チャンクが届くのを待ってからやり直す
      await settle(error.thenable);
    }
  }
};
