// Server Actions（仕様 8 章）のサーバー側。HTTP は使わず、引数と戻り値は Flight（encodeReply / decodeReply）で往復させる。
// Action の id → 関数は、SWC の変換結果が呼ぶ registerServerReference を記録して引く（src/next/preload.ts）。

export type ActionCall = {
  // Server Action の id（ハッシュ）
  id: string;
  // 関数名
  name: string;
  // サーバー側で受け取った引数（.bind した引数を含む）
  args: unknown[];
};

// 呼び出しを名前（関数名）か Action そのもの（$$id）で絞る
export const filterCalls = (calls: ActionCall[], action?: string | Function): ActionCall[] =>
  action === undefined
    ? [...calls]
    : calls.filter((call) => (typeof action === "string" ? call.name === action : call.id === (action as { $$id?: string }).$$id));

export const serverActions: Map<string, Function> = ((globalThis as any)[Symbol.for("proofyard.serverActions")] ??= new Map());

// decodeReply で Server Reference（bind した Action など）を引くときのモジュール id
export const ACTION_MODULE_PREFIX = "proofyard-server-action:";

export const actionModule = (id: string) => {
  if (!id.startsWith(ACTION_MODULE_PREFIX)) return undefined;
  const action = serverActions.get(id.slice(ACTION_MODULE_PREFIX.length));
  if (!action) throw new Error(`[proofyard] unknown Server Action ${id.slice(ACTION_MODULE_PREFIX.length)}`);
  return action;
};

const serverManifest = new Proxy(
  {},
  { get: (_, id) => (typeof id === "string" ? { id: ACTION_MODULE_PREFIX + id, chunks: [], name: "" } : undefined) },
);

const isRedirect = (error: unknown) => typeof (error as { digest?: unknown })?.digest === "string" && (error as { digest: string }).digest.startsWith("NEXT_REDIRECT");

// クライアントから届いた本文で Action を実行する。result は（Flight にそのまま載せる）戻り値の Promise
export async function runAction(id: string, body: string | FormData, calls: ActionCall[]): Promise<{ result: Promise<unknown> }> {
  const action = serverActions.get(id);
  if (!action) throw new Error(`[proofyard] unknown Server Action ${id}`);
  const { decodeReply } = require("react-server-dom-webpack/server");
  const args: unknown[] = await decodeReply(body, serverManifest);
  calls.push({ id, name: action.name, args });
  const result = (async () => {
    try {
      return await action(...args);
    } catch (error) {
      // ponytail: redirect は Next.js のルーターが処理する。コンポーネント単位の render() にはルーターがないので Fail Closed
      if (isRedirect(error)) throw new Error("[proofyard] Unsupported: redirect() from a Server Action needs the Next.js router (route rendering)");
      throw error;
    }
  })();
  return { result };
}
