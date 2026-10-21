import { expect, mock, test } from "bun:test";
import { join } from "node:path";
import { renderRSC, type ServerReference } from "proofyard";
import { UserList } from "../fixtures/next-app/components/user-list";
import { LikeButton } from "../fixtures/next-app/components/like-button";

test("非同期の Server Component を Flight 経由で描画し、テキストで検査する", async () => {
  const result = await renderRSC(<UserList />);
  expect(result.getByText("Users").type).toBe("h1");
  expect((await result.findByText("Alice")).type).toBe("span");
  expect(result.getAllByText(/^(Alice|Bob)$/)).toHaveLength(2);
});

test("Suspense の途中状態: データが届くまでは fallback、解決すると中身", async () => {
  const users = Promise.withResolvers<{ id: number; name: string }[]>();
  mock.module(join(import.meta.dir, "../fixtures/next-app/components/users.ts"), () => ({ getUsers: () => users.promise }));
  const result = await renderRSC(<UserList />);
  // シェル（Suspense の外）は揃っている
  expect(result.getByText("Users").type).toBe("h1");
  expect(result.getByText("Loading users...").type).toBe("p");
  expect(result.queryByText("Alice")).toBeNull();
  users.resolve([{ id: 1, name: "Alice" }]);
  await result.waitForComplete();
  expect(result.getByText("Alice").type).toBe("span");
  expect(result.queryByText("Loading users...")).toBeNull();
});

test("findByText は期限までに現れなければ失敗する", async () => {
  const never = Promise.withResolvers<never>();
  mock.module(join(import.meta.dir, "../fixtures/next-app/components/users.ts"), () => ({ getUsers: () => never.promise }));
  const result = await renderRSC(<UserList />);
  await expect(result.findByText("Alice", { timeout: 50 })).rejects.toThrow("Unable to find an element with the text: Alice");
  await expect(result.waitForComplete({ timeout: 50 })).rejects.toThrow("Suspense boundaries are still pending");
});

test("Client Component は実行せず、Client Reference と props を検査できる", async () => {
  mock.module(join(import.meta.dir, "../fixtures/next-app/components/users.ts"), () => ({
    getUsers: async () => [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ],
  }));
  const result = await renderRSC(<UserList />);
  await result.waitForComplete();
  const buttons = result.getAllClientReferences(LikeButton);
  expect(buttons.map((b) => b.props)).toEqual([
    { userId: 1, initial: 0 },
    { userId: 2, initial: 0 },
  ]);
  expect(buttons[0]!.type).toEqual({ id: join(import.meta.dir, "../fixtures/next-app/components/like-button.tsx"), name: "LikeButton" });
  // 実行していないので、ボタンの描画結果（likes: 0）はない
  expect(result.queryByText(/likes/)).toBeNull();
});

test("Server Component の例外は元のエラーとして renderRSC から投げられる", async () => {
  async function Broken(): Promise<never> {
    throw new Error("database is down");
  }
  await expect(renderRSC(<main><Broken /></main>)).rejects.toThrow("database is down");
});

test("Client Component に関数を渡すと Flight のシリアライズエラーになる", async () => {
  const format = (n: number) => `${n}`;
  const Bad = LikeButton as unknown as (props: object) => React.ReactNode;
  await expect(renderRSC(<Bad userId={1} initial={0} format={format} />)).rejects.toThrow(
    "Functions cannot be passed directly to Client Components",
  );
});

test("mock.module で Server Component のデータ取得を差し替えられる", async () => {
  const getUsers = mock(async () => [{ id: 9, name: "Mocked" }]);
  mock.module(join(import.meta.dir, "../fixtures/next-app/components/users.ts"), () => ({ getUsers }));
  const result = await renderRSC(<UserList />);
  expect((await result.findByText("Mocked")).type).toBe("span");
  expect(result.queryByText("Alice")).toBeNull();
  expect(getUsers).toHaveBeenCalledTimes(1);
});

test("リクエストの外で cookies() を使うと Next.js 自身のエラーになる（Fail Closed）", async () => {
  const { cookies } = await import("next/headers");
  async function NeedsCookies() {
    return <p>{(await cookies()).get("theme")?.value}</p>;
  }
  await expect(renderRSC(<NeedsCookies />)).rejects.toThrow("outside a request scope");
});

test("Client Component に渡した Server Function は参照（$$id と bind した引数）として検査できる", async () => {
  const { renameUser } = await import("../fixtures/next-app/components/actions");
  const { RenameForm } = await import("../fixtures/next-app/components/rename-form");
  const result = await renderRSC(<RenameForm action={renameUser.bind(null, "core", 7)} />);
  const action = result.getClientReference(RenameForm).props.action as ServerReference;
  expect(action.$$id).toBe((renameUser as unknown as ServerReference).$$id);
  expect(action.$$bound).toEqual(["core", 7]);
  expect(() => action(new FormData())).toThrow("Server Functions are not called in renderRSC");
});

test("Suspense の中で起きた例外は、待っている側に元のエラーとして届く", async () => {
  const users = Promise.withResolvers<never>();
  mock.module(join(import.meta.dir, "../fixtures/next-app/components/users.ts"), () => ({ getUsers: () => users.promise }));
  const result = await renderRSC(<UserList />);
  expect(result.getByText("Loading users...").type).toBe("p");
  users.reject(new Error("users service unavailable"));
  await expect(result.waitForComplete()).rejects.toThrow("users service unavailable");
});

test("mock.module の差し替えはテストの後に戻る（仕様 19 章）: 差し替える", async () => {
  mock.module(join(import.meta.dir, "../fixtures/next-app/components/users.ts"), () => ({ getUsers: async () => [{ id: 9, name: "Leaked" }] }));
  expect(await renderRSC(<UserList />).then((r) => r.findByText("Leaked"))).toBeTruthy();
});

test("mock.module の差し替えはテストの後に戻る（仕様 19 章）: 次のテストは本物", async () => {
  const result = await renderRSC(<UserList />);
  expect(await result.findByText("Alice")).toBeTruthy();
  expect(result.queryByText("Leaked")).toBeNull();
});
