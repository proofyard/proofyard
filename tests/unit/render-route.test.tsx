// renderRoute の Client Mode で、Server Actions を Next.js 本体のルーター（fetch → メモリ内の handler）で動かす
import { beforeEach, expect, test } from "bun:test";
import { renderRoute } from "proofyard";
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
