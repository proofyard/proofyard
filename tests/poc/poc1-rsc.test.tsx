// PoC 1（仕様22章）: Bun 上で React 公式の RSC Renderer と Flight を動かす。
// `bun --conditions react-server test` で実行する（package.json の test:poc1）。
/* oxlint-disable typescript/no-explicit-any -- Flight でデコードしたツリーを動的にたどる */
import { expect, test } from "bun:test";

import { Suspense } from "react";
import type { ReactNode } from "react";
import { createFromReadableStream } from "react-server-dom-turbopack/client";
import { renderToReadableStream } from "react-server-dom-turbopack/server";

const REACT_ELEMENT = Symbol.for("react.transitional.element");
const REACT_LAZY = Symbol.for("react.lazy");

const deferred = <T,>() => {
  const { promise, reject, resolve } = Promise.withResolvers<T>();
  return { promise, reject, resolve };
};

// Server Component -> Flight エンコード -> Flight デコード
const flight = (node: ReactNode) => {
  const errors: unknown[] = [];
  const stream = renderToReadableStream(
    node,
    {},
    {
      onError: (e: unknown) => {
        errors.push(e);
      },
    }
  );
  const root = createFromReadableStream(stream, {
    serverConsumerManifest: {
      moduleLoading: null,
      moduleMap: {},
      serverModuleMap: null,
    },
  });
  // Flight の戻り値は .then() が何も返さない thenable なので、本物の Promise にする
  return { errors, root: Promise.resolve(root) as Promise<any> };
};

// デコード済みツリーの lazy を解決しながら文字列を集める（RSC Mode の構造検査の最小版）
// ponytail: lazy の _init/_payload を直接触る。正式な renderRSC() ではクエリ API に置き換える
const text = async (node: any): Promise<string> => {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    const parts = await Promise.all(node.map(text));
    return parts.join("");
  }
  if (typeof node.then === "function") {
    return text(await node);
  }
  if (node.$$typeof === REACT_LAZY) {
    for (;;) {
      try {
        return text(node._init(node._payload));
      } catch (error: any) {
        if (typeof error?.then !== "function") {
          throw error;
        }
        // oxlint-disable-next-line no-await-in-loop -- lazy が解決するまで待ってから読み直す
        await error;
      }
    }
  }
  if (node.$$typeof === REACT_ELEMENT) {
    return text(node.props.children);
  }
  throw new Error(`unexpected node: ${String(node)}`);
};

const User = async () => {
  const name = await Promise.resolve("Alice");
  return <p>{name}</p>;
};

// oxlint-disable-next-line require-await -- async の Server Component の例外（reject）を確かめる
const Broken = async (): Promise<ReactNode> => {
  throw new Error("boom");
};

test("非同期 Server Component が Flight を往復する", async () => {
  const { root, errors } = flight(
    <main>
      <h1>Users</h1>
      <User />
    </main>
  );
  expect(await text(await root)).toBe("UsersAlice");
  expect(errors).toEqual([]);
});

test("JSON にない値（Map, Date, bigint）も Flight で復元される", async () => {
  const value = { d: new Date(0), m: new Map([["a", 1]]), n: 10n };
  const { root } = flight(value as any);
  const out = await root;
  expect(out.m).toBeInstanceOf(Map);
  expect(out.m.get("a")).toBe(1);
  expect(out.d).toBeInstanceOf(Date);
  expect(out.n).toBe(10n);
});

test("Suspense: 先にシェルが届き、データは後からストリームされる", async () => {
  const data = deferred<string>();
  const Slow = async () => <span>{await data.promise}</span>;
  const { root } = flight(
    <div>
      <Suspense fallback={<i>Loading...</i>}>
        <Slow />
      </Suspense>
    </div>
  );
  // Slow が未解決でもルートは解決する
  const tree = await root;
  const boundary = tree.props.children;
  expect(boundary.type).toBe(Suspense);
  expect(await text(boundary.props.fallback)).toBe("Loading...");

  let done = false;
  const content = text(boundary.props.children).then((t) => {
    done = true;
    return t;
  });
  await Bun.sleep(10);
  // まだ届いていない
  expect(done).toBe(false);

  data.resolve("Alice");
  expect(await content).toBe("Alice");
});

test("シリアライズできない props はエラーとして検出される", async () => {
  const { root, errors } = flight(
    <button type="button" onClick={() => {}}>
      x
    </button>
  );
  const err = await root.then(text).catch((error) => error);
  // クライアント側
  expect(err.message).toMatch(/Event handlers cannot be passed/u);
  // サーバー側 onError
  expect(String(errors[0])).toMatch(/Event handlers cannot be passed/u);
});

test("Server Component の例外がクライアント側に伝播する", async () => {
  const { root, errors } = flight(
    <div>
      <Broken />
    </div>
  );
  const err = await root.then(text).catch((error) => error);
  // dev ビルドではメッセージがそのまま届く
  expect(err.message).toBe("boom");
  expect(String(errors[0])).toMatch(/boom/u);
});
