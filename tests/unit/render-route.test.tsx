// renderRoute の Client Mode で、Server Actions を Next.js 本体のルーター（fetch → メモリ内の handler）で動かす
import { beforeEach, expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";
import { addUser } from "../fixtures/next-app/app/users/actions";
import { db } from "../fixtures/next-app/components/users/db";

beforeEach(() => {
  db.users = ["Alice"];
});

test("form の Server Action と revalidatePath で、Server Components の表示が新しくなる", async () => {
  const app = await renderRoute("/users");
  await app.user.type(app.getByRole("textbox", { name: "new user" }), "Bob");
  await app.user.click(app.getByRole("button", { name: "Add" }));
  await app.findByText("Bob");
  expect(db.users).toEqual(["Alice", "Bob"]);
  expect(app.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Alice", "Bob"]);
});

test("app.actions.getCalls と app.cache.getInvalidatedTags で、Server Action の呼び出しと無効化したキャッシュを確かめる（仕様 28 章）", async () => {
  const app = await renderRoute("/users");
  expect(app.actions.getCalls()).toEqual([]);
  await app.user.type(app.getByRole("textbox", { name: "new user" }), "Bob");
  await app.user.click(app.getByRole("button", { name: "Add" }));
  await app.findByText("Bob");
  const calls = app.actions.getCalls("addUser");
  expect(calls).toHaveLength(1);
  expect((calls[0]!.args.at(-1) as FormData).get("name")).toBe("Bob");
  expect(app.actions.getCalls(addUser)).toEqual(calls);
  expect(app.actions.getCalls("addAndOpen")).toEqual([]);
  expect(app.cache.getInvalidatedTags()).toContain("_N_T_/users");
});

test("Server Action の呼び出しの記録はテストごとに分かれる", async () => {
  const app = await renderRoute("/users");
  expect(app.actions.getCalls()).toEqual([]);
  expect(app.cache.getInvalidatedTags()).toEqual([]);
});

test("同じテストで renderRoute をもう一度呼ぶと、ブラウザでページを読み込み直したのと同じく前のページを捨てる", async () => {
  const first = await renderRoute("/users");
  await first.user.type(first.getByRole("textbox", { name: "new user" }), "Bob");
  await first.user.click(first.getByRole("button", { name: "Add" }));
  await first.findByText("Bob");
  const app = await renderRoute("/users");
  expect(app.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Alice", "Bob"]);
  await app.user.type(app.getByRole("textbox", { name: "new user" }), "Carol");
  await app.user.click(app.getByRole("button", { name: "Add" }));
  await app.findByText("Carol");
  expect(app.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Alice", "Bob", "Carol"]);
});

test("Server Action の redirect() でページが移る", async () => {
  const app = await renderRoute("/users");
  await app.user.type(app.getByRole("textbox", { name: "open user" }), "Carol");
  await app.user.click(app.getByRole("button", { name: "Add and open" }));
  await app.findByRole("heading", { name: "Profile Carol" });
  expect(location.pathname).toBe("/users/Carol");
});

test("JS なしのフォームの送信（progressive enhancement）: Action の後のページ、redirect は 303", async () => {
  const actionIds = [...(await (await requestRoute("/users")).text()).matchAll(/name="(\$ACTION_ID_[0-9a-f]+)"/g)].map((m) => m[1]!);
  const form = (id: string, name: string) => {
    const body = new FormData();
    body.set(id, "");
    body.set("name", name);
    return body;
  };
  const added = await requestRoute("/users", { method: "POST", body: form(actionIds[0]!, "Bob") });
  expect(added.status).toBe(200);
  expect(await added.text()).toContain("<li>Bob</li>");
  const opened = await requestRoute("/users", { method: "POST", body: form(actionIds[1]!, "Carol") });
  expect(opened.status).toBe(303);
  expect(opened.headers.get("location")).toBe("/users/Carol");
});
