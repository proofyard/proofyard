// Server Actions（仕様 8 章）のサーバー側。HTTP は使わず、引数と戻り値は Flight（encodeReply / decodeReply）で往復させる。
// Action の id → 関数は、SWC の変換結果が呼ぶ registerServerReference を記録して引く（src/next/preload.ts）。

export interface ActionCall {
  // Server Action の id（ハッシュ）
  id: string;
  // 関数名
  name: string;
  // サーバー側で受け取った引数（.bind した引数を含む）
  args: unknown[];
}

// 任意の Server Action（引数・戻り値はさまざま）を受ける型
// oxlint-disable-next-line typescript/ban-types, typescript/no-unsafe-function-type -- 引数・戻り値が不定の関数を受けるため
export type ServerActionFunction = Function;

// 呼び出しを名前（関数名）か Action そのもの（$$id）で絞る
export const filterCalls = (
  calls: ActionCall[],
  action?: string | ServerActionFunction
): ActionCall[] =>
  action === undefined
    ? [...calls]
    : calls.filter((call) =>
        typeof action === "string"
          ? call.name === action
          : call.id === (action as { $$id?: string }).$$id
      );

const actionRegistry = globalThis as unknown as Record<
  symbol,
  Map<string, ServerActionFunction> | undefined
>;
const SERVER_ACTIONS = Symbol.for("proofyard.serverActions");
// 同じ globalThis では最初に作った Map を使い回す
export const serverActions: Map<string, ServerActionFunction> =
  actionRegistry[SERVER_ACTIONS] ?? new Map();
actionRegistry[SERVER_ACTIONS] = serverActions;

// decodeReply で Server Reference（bind した Action など）を引くときのモジュール id
export const ACTION_MODULE_PREFIX = "proofyard-server-action:";

export const actionModule = (id: string) => {
  if (!id.startsWith(ACTION_MODULE_PREFIX)) {
    return;
  }
  const action = serverActions.get(id.slice(ACTION_MODULE_PREFIX.length));
  if (!action) {
    throw new Error(
      `[proofyard] unknown Server Action ${id.slice(ACTION_MODULE_PREFIX.length)}`
    );
  }
  return action;
};

const serverManifest = new Proxy(
  {},
  {
    get: (_, id) =>
      typeof id === "string"
        ? { chunks: [], id: ACTION_MODULE_PREFIX + id, name: "" }
        : undefined,
  }
);

const isRedirect = (error: unknown) =>
  typeof (error as { digest?: unknown })?.digest === "string" &&
  (error as { digest: string }).digest.startsWith("NEXT_REDIRECT");

// クライアントから届いた本文で Action を実行する。result は（Flight にそのまま載せる）戻り値の Promise
export const runAction = async (
  id: string,
  body: string | FormData,
  calls: ActionCall[]
): Promise<{ result: Promise<unknown> }> => {
  const action = serverActions.get(id);
  if (!action) {
    throw new Error(`[proofyard] unknown Server Action ${id}`);
  }
  // oxlint-disable-next-line node/global-require, unicorn/prefer-module -- 実行時に Next.js 同梱のものを同期で解決する（package.json の依存にない）
  const { decodeReply } = require("react-server-dom-webpack/server");
  const args: unknown[] = await decodeReply(body, serverManifest);
  calls.push({ args, id, name: action.name });
  const result = (async () => {
    try {
      return await action(...args);
    } catch (error) {
      // ponytail: redirect は Next.js のルーターが処理する。コンポーネント単位の render() にはルーターがないので Fail Closed
      if (isRedirect(error)) {
        throw new Error(
          "[proofyard] Unsupported: redirect() from a Server Action needs the Next.js router (route rendering)",
          { cause: error }
        );
      }
      throw error;
    }
  })();
  return { result };
};
