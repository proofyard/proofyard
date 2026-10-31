import { expect, mock, test } from "bun:test";
import path from "node:path";

import { render } from "proofyard";
import { Suspense } from "react";

import { Modal } from "../fixtures/next-app/components/modal";
import { UserList } from "../fixtures/next-app/components/user-list";
import { UserNames } from "../fixtures/next-app/components/user-names";

test("Portal: コンテナの外に描画された要素も検査できる", async () => {
  const result = await render(
    <Modal title="Settings">
      <p>modal body from the server</p>
    </Modal>
  );
  expect(result.queryByRole("dialog")).toBeNull();
  // oxlint-disable-next-line typescript/no-non-null-assertion -- render() の user はブラウザで描画したときにある
  await result.user!.click(
    result.getByRole("button", { name: "open Settings" })
  );
  expect(result.getByRole("dialog", { name: "Settings" }).textContent).toBe(
    "modal body from the server"
  );
});

test("Client Mode の Suspense: Server Component のデータが届くまでは fallback", async () => {
  const users = Promise.withResolvers<{ id: number; name: string }[]>();
  mock.module(
    path.join(import.meta.dir, "../fixtures/next-app/components/users.ts"),
    () => ({ getUsers: () => users.promise })
  );
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
    </Suspense>
  );
  expect(result.getByText("waiting")).toBeDefined();
  users.resolve([{ id: 1, name: "Bob" }]);
  await result.findByText("Bob");
});
