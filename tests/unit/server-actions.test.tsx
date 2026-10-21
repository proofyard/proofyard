// Server Actions（仕様 8 章）: Client Mode の render() から、HTTP なしで Flight（encodeReply / decodeReply）を往復させて実行する
import { beforeEach, expect, test } from "bun:test";
import { render } from "proofyard";
import { db } from "../fixtures/next-app/components/users/db";
import { createUser, echo, fail, joinTeam, leak, like } from "../fixtures/next-app/components/users/actions";
import { CallButton, LikeCounter } from "../fixtures/next-app/components/users/user-form";
import { UsersPage } from "../fixtures/next-app/components/users/users-page";

beforeEach(() => {
  db.users.length = 0;
  db.likes = 0;
  db.gate = null;
});

test("useActionState: フォームを送信し、Action の結果と描画し直した Server Components が表示される", async () => {
  const app = await render(<UsersPage />);
  await app.user!.type(app.getByRole("textbox"), "Alice");
  await app.user!.click(app.getByRole("button", { name: "Create" }));
  expect((await app.findByRole("status")).textContent).toBe("Created Alice");
  // RSC Refresh: サーバー側のデータの変更が Server Component の一覧に出る
  expect((await app.findByRole("listitem")).textContent).toBe("Alice");
  const calls = app.actions.getCalls(createUser);
  expect(calls).toHaveLength(1);
  expect((calls[0]!.args[1] as FormData).get("name")).toBe("Alice");
});

test("useFormStatus: Action の完了前は pending", async () => {
  const gate = Promise.withResolvers<void>();
  db.gate = gate.promise;
  const app = await render(<UsersPage />);
  await app.user!.type(app.getByRole("textbox"), "Bob");
  await app.user!.click(app.getByRole("button", { name: "Create" }));
  await app.findByRole("button", { name: "Saving..." });
  gate.resolve();
  expect((await app.findByRole("status")).textContent).toBe("Created Bob");
  expect(app.getByRole("button", { name: "Create" })).toBeDefined();
});

test("サーバー側の検証エラーを返す", async () => {
  const app = await render(<UsersPage />);
  await app.user!.click(app.getByRole("button", { name: "Create" }));
  expect((await app.findByRole("alert")).textContent).toBe("Name is required");
  expect(db.users).toEqual([]);
});

test(".bind() した Server Action を props で渡す", async () => {
  const app = await render(<UsersPage />);
  await app.user!.click(app.getByRole("button", { name: "Join" }));
  await app.findByRole("button", { name: "Alice joined core" });
  expect(app.actions.getCalls(joinTeam)[0]!.args).toEqual(["core", "Alice"]);
});

test("引数と戻り値は Flight で往復する（Date / Map / bigint / Set）", async () => {
  const value = { at: new Date(0), tags: new Map([["a", 1]]), big: 10n, set: new Set(["x"]) };
  const app = await render(<CallButton label="echo" action={echo.bind(null, value)} />);
  await app.user!.click(app.getByRole("button", { name: "echo" }));
  await app.findByRole("button", { name: "ok: object" });
  const [received] = app.actions.getCalls(echo)[0]!.args as [typeof value];
  expect(received.at).toBeInstanceOf(Date);
  expect(received.tags.get("a")).toBe(1);
  expect(received.big).toBe(10n);
  expect(received.set.has("x")).toBe(true);
});

test("シリアライズできない戻り値はエラーになる", async () => {
  const app = await render(<CallButton label="leak" action={leak} />);
  await app.user!.click(app.getByRole("button", { name: "leak" }));
  const button = await app.findByRole("button", { name: /^error: / });
  expect(button.textContent).toContain("Functions cannot be passed directly to Client Components");
});

test("Action の例外はクライアントに元のエラーとして届く", async () => {
  const app = await render(<CallButton label="fail" action={fail} />);
  await app.user!.click(app.getByRole("button", { name: "fail" }));
  await app.findByRole("button", { name: "error: action failed on the server" });
});

test("useOptimistic: 完了前は楽観的な値、完了後はサーバーの値", async () => {
  const gate = Promise.withResolvers<void>();
  db.gate = gate.promise;
  const app = await render(<LikeCounter likes={0} like={like} />);
  await app.user!.click(app.getByRole("button", { name: "likes: 0" }));
  await app.findByRole("button", { name: "likes: 1" });
  expect(db.likes).toBe(0);
  gate.resolve();
  await app.findByRole("button", { name: "likes: 1" });
  expect(db.likes).toBe(1);
});

test("クロージャの Server Action（関数の中の \"use server\"）は、閉じ込めた値をサーバーで受け取る", async () => {
  const { Greeting } = await import("../fixtures/next-app/components/users/greeting");
  const app = await render(<Greeting team="core" />);
  await app.user!.click(app.getByRole("button", { name: "greet" }));
  const button = await app.findByRole("button", { name: /^(ok|error)/ });
  expect(button.textContent).toBe("ok: string");
});
