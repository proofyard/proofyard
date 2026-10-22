// renderRoute の Client Mode で、Server Actions を Next.js 本体のルーター（fetch → メモリ内の handler）で動かす
import { beforeEach, expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";
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
