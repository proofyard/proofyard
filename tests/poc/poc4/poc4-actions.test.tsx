// PoC 4（仕様22章）: Client Component から Server Action を実行する。HTTP は使わない。
// Client: encodeReply → Server: decodeReply → 実行 → Flight { returnValue, root } → Client: UI 更新
// `bun run test:poc4` で実行する。このファイル自体は Server Graph で動く。
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { ReactNode } from "react";
import { decodeReply, renderToReadableStream } from "react-server-dom-turbopack/server";
import { installDom } from "../../../src/dom/environment";
import { CLIENT, clientModules } from "../poc2/plugin";
import UsersPage from "./fixtures/page";
import { db } from "./fixtures/db";

installDom(); // Client Graph の react-dom/client を読む前に

const flight = await import(join(import.meta.dir, "../poc2/client-runtime.ts") + CLIENT);
const rtl = await import(join(import.meta.dir, "../poc3/dom-runtime.ts") + CLIENT);
// Client Graph から見た actions.ts（Server Reference だけを持つ）
const clientActions = await import(join(import.meta.dir, "fixtures/actions.ts") + CLIENT);

function manifests() {
  const ids = [...clientModules];
  return {
    client: Object.fromEntries(ids.map((id) => [id, { id, chunks: [], name: "*" }])),
    consumer: {
      moduleMap: Object.fromEntries(ids.map((id) => [id, { "*": { id, chunks: [], name: "*" } }])),
      serverModuleMap: null,
      moduleLoading: null,
    },
  };
}

// Server 側の Action 実行（Server Graph）
const calls: { id: string; args: unknown[] }[] = [];
const serverErrors: unknown[] = [];
let page: () => ReactNode = () => null;

(globalThis as any).__proofyard.handleAction = async (id: string, body: string | FormData) => {
  const at = id.lastIndexOf("#");
  const fn = (await import(id.slice(0, at)))[id.slice(at + 1)];
  // 登録済みの Server Reference だけを実行する
  if (fn?.$$typeof !== Symbol.for("react.server.reference") || fn.$$id !== id) throw new Error(`unknown action: ${id}`);
  const args = await decodeReply(body, {});
  calls.push({ id, args });
  const returnValue = await fn(...args);
  return renderToReadableStream({ returnValue, root: page() }, manifests().client, {
    onError: (e: unknown) => void serverErrors.push(e),
  });
};

async function renderPage(node: () => ReactNode) {
  page = node;
  const m = manifests();
  const stream = renderToReadableStream(node(), m.client);
  await flight.loadClientModules(clientModules);
  const tree = await flight.decode(stream, m.consumer);
  await rtl.act(async () => void rtl.render(flight.withRoot(tree)));
}

beforeEach(() => {
  db.users.length = 0;
  db.gate = null;
  calls.length = 0;
  serverErrors.length = 0;
});
afterEach(() => rtl.cleanup());

test("useActionState: フォーム送信 → Server Action → 戻り値と RSC Refresh で UI が更新される", async () => {
  await renderPage(() => <UsersPage />);
  const user = rtl.userEvent.setup();
  await user.type(rtl.screen.getByLabelText("Name"), "Alice");
  await user.click(rtl.screen.getByRole("button", { name: "Create" }));

  // 戻り値（useActionState の state）
  expect((await rtl.screen.findByRole("status")).textContent).toBe("Created Alice");
  // Server のデータが更新され、再レンダリングされた Server Component の一覧に出る
  expect(db.users).toEqual(["Alice"]);
  expect(rtl.screen.getByRole("list", { name: "users" }).textContent).toBe("Alice");
  // 引数は FormData として Server に届いた（シリアライズを経由）
  const [prev, formData] = calls[0]!.args as [unknown, FormData];
  expect(prev).toEqual({});
  expect(formData).toBeInstanceOf(FormData);
  expect(formData.get("name")).toBe("Alice");
});

test("useFormStatus: Action の完了前は pending になる", async () => {
  let open!: () => void;
  db.gate = new Promise((r) => (open = r));
  await renderPage(() => <UsersPage />);
  const user = rtl.userEvent.setup();
  await user.type(rtl.screen.getByLabelText("Name"), "Bob");
  await user.click(rtl.screen.getByRole("button", { name: "Create" }));
  expect(await rtl.screen.findByRole("button", { name: "Saving..." })).toBeTruthy();

  open();
  expect((await rtl.screen.findByRole("status")).textContent).toBe("Created Bob");
  expect(rtl.screen.getByRole("button", { name: "Create" })).toBeTruthy();
});

test("Action の戻り値でバリデーションエラーを返す", async () => {
  await renderPage(() => <UsersPage />);
  await rtl.userEvent.click(rtl.screen.getByRole("button", { name: "Create" }));
  expect((await rtl.screen.findByRole("alert")).textContent).toBe("Name is required");
  expect(db.users).toEqual([]);
});

test(".bind() で束縛した引数が Server に届く", async () => {
  await renderPage(() => <UsersPage />);
  await rtl.userEvent.click(rtl.screen.getByRole("button", { name: "Join" }));
  expect(await rtl.screen.findByRole("button", { name: "Alice joined core" })).toBeTruthy();
  expect(calls[0]!.args).toEqual(["core", "Alice"]);
});

test("引数と戻り値は Flight でシリアライズされる（JSON にない型も往復する）", async () => {
  const value = { d: new Date(0), m: new Map([["a", 1n]]), s: new Set(["x"]), u: undefined };
  const back = await clientActions.echo(value);
  expect(back).not.toBe(value); // 同じオブジェクトではない
  expect(back).toEqual(value);
  expect(back.m.get("a")).toBe(1n);
});

test("シリアライズできない引数・戻り値はエラーになる", async () => {
  const badArg = await clientActions.echo({ f: () => {} }).catch((e: Error) => e);
  expect(String(badArg)).toMatch(/Functions cannot be passed|not serializable|Could not/i);
  expect(calls).toEqual([]); // Server まで届いていない

  const badReturn = await clientActions.leak().catch((e: Error) => e);
  expect(String(badReturn)).toMatch(/Functions cannot be passed/);
});

test("Client Graph の actions.ts は実装を持たない", () => {
  expect(clientActions.createUser.$$typeof).toBeUndefined(); // Server Reference の登録情報は Server 側だけ
  expect(String(clientActions.createUser)).not.toContain("db.users");
});

test("関数レベルの \"use server\" は Fail Closed", async () => {
  const err = await import("./fixtures/inline-action").catch((e: Error) => e);
  expect(String(err)).toMatch(/Unsupported: function-level "use server"/);
});
