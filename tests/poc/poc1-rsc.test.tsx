// PoC 1（仕様22章）: Bun 上で React 公式の RSC Renderer と Flight を動かす。
// `bun --conditions react-server test` で実行する（package.json の test:poc1）。
import { expect, test } from "bun:test";
import { Suspense, type ReactNode } from "react";
import { renderToReadableStream } from "react-server-dom-turbopack/server";
import { createFromReadableStream } from "react-server-dom-turbopack/client";

const REACT_ELEMENT = Symbol.for("react.transitional.element");
const REACT_LAZY = Symbol.for("react.lazy");

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

// Server Component -> Flight エンコード -> Flight デコード
function flight(node: ReactNode) {
  const errors: unknown[] = [];
  const stream = renderToReadableStream(node, {}, { onError: (e: unknown) => void errors.push(e) });
  const root = createFromReadableStream(stream, {
    serverConsumerManifest: { moduleMap: {}, serverModuleMap: null, moduleLoading: null },
  });
  // Flight の戻り値は .then() が何も返さない thenable なので、本物の Promise にする
  return { root: Promise.resolve(root) as Promise<any>, errors };
}

// デコード済みツリーの lazy を解決しながら文字列を集める（RSC Mode の構造検査の最小版）
// ponytail: lazy の _init/_payload を直接触る。正式な renderRSC() ではクエリ API に置き換える
async function text(node: any): Promise<string> {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return (await Promise.all(node.map(text))).join("");
  if (typeof node.then === "function") return text(await node);
  if (node.$$typeof === REACT_LAZY) {
    for (;;) {
      try {
        return text(node._init(node._payload));
      } catch (thrown: any) {
        if (typeof thrown?.then !== "function") throw thrown;
        await thrown;
      }
    }
  }
  if (node.$$typeof === REACT_ELEMENT) return text(node.props.children);
  throw new Error(`unexpected node: ${String(node)}`);
}

test("非同期 Server Component が Flight を往復する", async () => {
  async function User() {
    const name = await Promise.resolve("Alice");
    return <p>{name}</p>;
  }
  const { root, errors } = flight(<main><h1>Users</h1><User /></main>);
  expect(await text(await root)).toBe("UsersAlice");
  expect(errors).toEqual([]);
});

test("JSON にない値（Map, Date, bigint）も Flight で復元される", async () => {
  const value = { m: new Map([["a", 1]]), d: new Date(0), n: 10n };
  const { root } = flight(value as any);
  const out = await root;
  expect(out.m).toBeInstanceOf(Map);
  expect(out.m.get("a")).toBe(1);
  expect(out.d).toBeInstanceOf(Date);
  expect(out.n).toBe(10n);
});

test("Suspense: 先にシェルが届き、データは後からストリームされる", async () => {
  const data = deferred<string>();
  async function Slow() {
    return <span>{await data.promise}</span>;
  }
  const { root } = flight(
    <div>
      <Suspense fallback={<i>Loading...</i>}><Slow /></Suspense>
    </div>,
  );
  const tree = await root; // Slow が未解決でもルートは解決する
  const boundary = tree.props.children;
  expect(boundary.type).toBe(Suspense);
  expect(await text(boundary.props.fallback)).toBe("Loading...");

  let done = false;
  const content = text(boundary.props.children).then((t) => ((done = true), t));
  await Bun.sleep(10);
  expect(done).toBe(false); // まだ届いていない

  data.resolve("Alice");
  expect(await content).toBe("Alice");
});

test("シリアライズできない props はエラーとして検出される", async () => {
  const { root, errors } = flight(<button onClick={() => {}}>x</button>);
  const err = await root.then(text).catch((e) => e);
  expect(err.message).toMatch(/Event handlers cannot be passed/); // クライアント側
  expect(String(errors[0])).toMatch(/Event handlers cannot be passed/); // サーバー側 onError
});

test("Server Component の例外がクライアント側に伝播する", async () => {
  async function Broken(): Promise<ReactNode> {
    throw new Error("boom");
  }
  const { root, errors } = flight(<div><Broken /></div>);
  const err = await root.then(text).catch((e) => e);
  expect(err.message).toBe("boom"); // dev ビルドではメッセージがそのまま届く
  expect(String(errors[0])).toMatch(/boom/);
});
