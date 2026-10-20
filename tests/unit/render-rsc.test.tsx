import { expect, mock, test } from "bun:test";
import { join } from "node:path";
import { renderRSC } from "proofyard";
import { UserList } from "../fixtures/next-app/components/user-list";
import { LikeButton } from "../fixtures/next-app/components/like-button";

test("非同期の Server Component を Flight 経由で描画し、テキストで検査する", async () => {
  const result = await renderRSC(<UserList />);
  expect(result.getByText("Users").type).toBe("h1");
  expect(result.getByText("Alice").type).toBe("span");
  // Suspense は解決後の中身になる
  expect(result.queryByText("Loading users...")).toBeNull();
  expect(result.getAllByText(/^(Alice|Bob)$/)).toHaveLength(2);
});

test("Client Component は実行せず、Client Reference と props を検査できる", async () => {
  const result = await renderRSC(<UserList />);
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
  expect(result.getByText("Mocked").type).toBe("span");
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
