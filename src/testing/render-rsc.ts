// RSC Mode（仕様 4.1）: Server Components を React 公式の RSC Renderer で描画し、Flight でシリアライズ・デシリアライズして、
// 得られた React ツリーの構造を検査する。DOM は作らず、Client Components は実行しない（Client Reference のまま残す）。
import { clientExports, clientIds } from "../next/layers";

const REACT_ELEMENT = Symbol.for("react.transitional.element");
const REACT_LAZY = Symbol.for("react.lazy");
const REACT_FRAGMENT = Symbol.for("react.fragment");
const REACT_SUSPENSE = Symbol.for("react.suspense");

// デコード時の Client Reference のモジュール id。本物の Client Component の代わりに目印のモジュールを返す
const PLACEHOLDER_PREFIX = "proofyard-client-reference:";
const CLIENT_REFERENCE = Symbol("proofyard.clientReference");

export type ClientReference = {
  // "use client" モジュールのパス
  id: string;
  // export 名
  name: string;
};
export type RSCHostElement = { type: string; props: Record<string, unknown>; children: RSCNode[] };
export type RSCClientElement = { type: ClientReference; props: Record<string, unknown>; children: RSCNode[] };
export type RSCElement = RSCHostElement | RSCClientElement;
export type RSCNode = RSCElement | string;
export type TextMatcher = string | RegExp;

// Server Function の参照（"use server"）。React の Server Reference と同じ $$id / $$bound を持ち、呼ぶとエラー
const SERVER_PLACEHOLDER_PREFIX = "proofyard-server-reference:";
export type ServerReference = ((...args: unknown[]) => never) & { $$id: string; $$bound: unknown[] | null };
function serverReference(id: string, bound: unknown[] | null): ServerReference {
  const reference = (() => {
    throw new Error("[proofyard] Server Functions are not called in renderRSC");
  }) as unknown as ServerReference;
  Object.assign(reference, {
    $$id: id,
    $$bound: bound,
    // Flight のデコードは bound 引数を .bind で付ける
    bind: (_this: unknown, ...args: unknown[]) => serverReference(id, [...(bound ?? []), ...args]),
  });
  return reference;
}

const placeholders = new Map<string, Record<string, unknown>>();
(globalThis as any)[Symbol.for("proofyard.clientReferencePlaceholder")] = (id: string) => {
  if (id.startsWith(SERVER_PLACEHOLDER_PREFIX)) return serverReference(id.slice(SERVER_PLACEHOLDER_PREFIX.length), null);
  if (!id.startsWith(PLACEHOLDER_PREFIX)) return undefined;
  const moduleId = id.slice(PLACEHOLDER_PREFIX.length);
  let module = placeholders.get(moduleId);
  if (!module) {
    module = Object.fromEntries(
      (clientExports.get(moduleId) ?? []).map((name) => {
        const placeholder = () => {
          throw new Error("[proofyard] Client Components are not executed in renderRSC");
        };
        Object.assign(placeholder, { [CLIENT_REFERENCE]: { id: moduleId, name } satisfies ClientReference });
        return [name, placeholder];
      }),
    );
    placeholders.set(moduleId, module);
  }
  return module;
};

const flightEntry = (id: string) => ({ id, name: "*", chunks: [], async: false });

// Flight でデコードしたものを、lazy や Promise を解決しながら RSCNode の列にする
async function toNodes(node: any): Promise<RSCNode[]> {
  if (node == null || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return [String(node)];
  if (Array.isArray(node)) return (await Promise.all(node.map(toNodes))).flat();
  if (typeof node.then === "function") return toNodes(await node);
  if (node.$$typeof === REACT_LAZY) return toNodes(await resolveLazy(node));
  if (node.$$typeof === REACT_ELEMENT) {
    const type = node.type?.$$typeof === REACT_LAZY ? await resolveLazy(node.type) : node.type;
    const { children, ...props } = node.props as Record<string, unknown>;
    // Suspense は解決後の中身だけを残す（fallback は表示されない）
    if (type === REACT_FRAGMENT || type === REACT_SUSPENSE) return toNodes(children);
    if (typeof type === "string") return [{ type, props, children: await toNodes(children) }];
    const reference = type?.[CLIENT_REFERENCE] as ClientReference | undefined;
    if (reference) return [{ type: reference, props, children: await toNodes(children) }];
    throw new Error(`[proofyard] Unsupported element type in the RSC payload: ${String(type?.toString?.() ?? type)}`);
  }
  throw new Error(`[proofyard] Unsupported value in the RSC payload: ${String(node)}`);
}

// React.lazy の解決（Flight のチャンクは未到着なら thenable を投げる）
async function resolveLazy(lazy: any): Promise<unknown> {
  for (;;) {
    try {
      return lazy._init(lazy._payload);
    } catch (thrown: any) {
      if (typeof thrown?.then !== "function") throw thrown;
      await thrown;
    }
  }
}

const textOf = (node: RSCNode): string => (typeof node === "string" ? node : node.children.map(textOf).join(""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const matches = (node: RSCNode, matcher: TextMatcher) => {
  const text = normalize(textOf(node));
  return typeof matcher === "string" ? text === matcher : matcher.test(text);
};
function* elements(nodes: RSCNode[]): Generator<RSCElement> {
  for (const node of nodes)
    if (typeof node !== "string") {
      yield node;
      yield* elements(node.children);
    }
}
const isClient = (element: RSCElement): element is RSCClientElement => typeof element.type !== "string";

export type RenderRSCResult = {
  // デコードしたツリー（Fragment と Suspense は展開済み）
  root: RSCNode[];
  // ツリー全体のテキスト
  text(): string;
  queryAllByText(matcher: TextMatcher): RSCElement[];
  queryByText(matcher: TextMatcher): RSCElement | null;
  getAllByText(matcher: TextMatcher): RSCElement[];
  getByText(matcher: TextMatcher): RSCElement;
  // Client Reference（export 名、または "use client" モジュールから import したもの）
  getAllClientReferences(component?: string | object): RSCClientElement[];
  getClientReference(component: string | object): RSCClientElement;
};

function createResult(root: RSCNode[]): RenderRSCResult {
  const dump = () => normalize(root.map(textOf).join(""));
  const queryAllByText = (matcher: TextMatcher) =>
    // テキストが一致する要素のうち、一番内側のもの
    [...elements(root)].filter((el) => matches(el, matcher) && !el.children.some((c) => typeof c !== "string" && matches(c, matcher)));
  const getAllByText = (matcher: TextMatcher) => {
    const found = queryAllByText(matcher);
    if (!found.length) throw new Error(`[proofyard] Unable to find an element with the text: ${matcher}\n\n${dump()}`);
    return found;
  };
  const getAllClientReferences = (component?: string | object) => {
    const match = (ref: ClientReference) => {
      if (component === undefined) return true;
      if (typeof component === "string") return ref.name === component;
      // "use client" モジュールを import したもの（registerClientReference の $$id は "パス#export名"）
      return (component as { $$id?: string }).$$id === `${ref.id}#${ref.name}`;
    };
    return [...elements(root)].filter(isClient).filter((el) => match(el.type));
  };
  const single = <T>(found: T[], what: string): T => {
    if (found.length !== 1) throw new Error(`[proofyard] Found ${found.length} elements for ${what} (expected 1)\n\n${dump()}`);
    return found[0]!;
  };
  return {
    root,
    text: dump,
    queryAllByText,
    queryByText: (matcher) => {
      const found = queryAllByText(matcher);
      return found.length ? single(found, `the text: ${matcher}`) : null;
    },
    getAllByText,
    getByText: (matcher) => single(getAllByText(matcher), `the text: ${matcher}`),
    getAllClientReferences,
    getClientReference: (component) => single(getAllClientReferences(component), `the client reference: ${typeof component === "string" ? component : (component as any).$$id}`),
  };
}

// Server Components を描画し、Flight を往復させた React ツリーを返す。
// 描画中のエラーは（本番の Flight では digest だけになるので）サーバー側の元のエラーとして投げる。
export async function renderRSC(model: unknown): Promise<RenderRSCResult> {
  const { renderToReadableStream } = require("react-server-dom-webpack/server");
  const { createFromReadableStream } = require("react-server-dom-webpack/client");
  const ids = [...clientIds];
  const errors: unknown[] = [];
  const stream = renderToReadableStream(model, Object.fromEntries(ids.map((id) => [id, flightEntry(id)])), {
    onError: (error: unknown) => void errors.push(error),
  });
  // Next.js 内蔵の Flight クライアントは globalThis.__next_require__ でモジュールを読む
  (globalThis as any).__next_require__ = (id: string) => (globalThis as any).__proofyardNextRequire(id);
  const response = createFromReadableStream(stream, {
    serverConsumerManifest: {
      moduleMap: Object.fromEntries(ids.map((id) => [id, { "*": flightEntry(PLACEHOLDER_PREFIX + id) }])),
      // Server Function の id はハッシュで事前に分からないので、どの id も目印のモジュールにする
      serverModuleMap: new Proxy({}, { get: (_, id) => (typeof id === "string" ? { id: SERVER_PLACEHOLDER_PREFIX + id, chunks: [], name: "" } : undefined) }),
      moduleLoading: null,
    },
  });
  try {
    return createResult(await toNodes(response));
  } catch (error) {
    if (errors.length) throw errors[0];
    throw error;
  }
}
