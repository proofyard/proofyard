import { expect, mock, test } from "bun:test";
import { join } from "node:path";
import { Suspense } from "react";
import { render } from "proofyard";
import { Modal } from "../fixtures/next-app/components/modal";
import { UserList } from "../fixtures/next-app/components/user-list";
import { UserNames } from "../fixtures/next-app/components/user-names";

test("Portal: コンテナの外に描画された要素も検査できる", async () => {
  const result = await render(
    <Modal title="Settings">
      <p>modal body from the server</p>
    </Modal>,
  );
  expect(result.queryByRole("dialog")).toBeNull();
  await result.user!.click(result.getByRole("button", { name: "open Settings" }));
  expect(result.getByRole("dialog", { name: "Settings" }).textContent).toBe("modal body from the server");
});

test("Client Mode の Suspense: Server Component のデータが届くまでは fallback", async () => {
  const users = Promise.withResolvers<{ id: number; name: string }[]>();
  mock.module(join(import.meta.dir, "../fixtures/next-app/components/users.ts"), () => ({ getUsers: () => users.promise }));
  const result = await render(<UserList />);
  expect(result.getByText("Loading users...")).toBeDefined();
  users.resolve([{ id: 1, name: "Alice" }]);
  await result.findByText("Alice");
  expect(result.queryByText("Loading users...")).toBeNull();
});

test("Client Mode の Suspense: Client Component が use() で待つ Promise（Server から Flight で渡す）", async () => {
  const users = Promise.withResolvers<{ id: number; name: string }[]>();
  const result = await render(
    <Suspense fallback={<p>waiting</p>}>
      <UserNames users={users.promise} />
    </Suspense>,
  );
  expect(result.getByText("waiting")).toBeDefined();
  users.resolve([{ id: 1, name: "Bob" }]);
  await result.findByText("Bob");
});
