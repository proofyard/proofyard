// Client Navigation（Next.js 本体のクライアントルーター）
import { beforeEach, expect, test } from "bun:test";
import { renderRoute } from "proofyard";
import { db } from "../fixtures/next-app/components/users/db";

beforeEach(() => {
  db.users = ["Alice"];
  db.gate = null;
});

test("Link のクリックでソフトナビゲーション（Layout の Client State は残る）", async () => {
  const app = await renderRoute("/dashboard");
  await app.user.click(app.getByRole("button", { name: "Layout clicks: 0" }));
  await app.user.click(app.getByRole("link", { name: "Settings" }));
  await app.findByRole("heading", { name: "Settings" });
  expect(location.pathname).toBe("/dashboard/settings");
  expect(app.getByText("Path: /dashboard/settings")).toBeTruthy();
  expect(app.getByRole("button", { name: "Layout clicks: 1" })).toBeTruthy();
});

test("router.push / back / forward（仕様 18.6）", async () => {
  const app = await renderRoute("/dashboard");
  await app.router.push("/dashboard/settings");
  expect(app.router.pathname).toBe("/dashboard/settings");
  expect(app.getByRole("heading", { name: "Settings" })).toBeTruthy();

  await app.router.back();
  expect(app.router.pathname).toBe("/dashboard");
  expect(app.getByRole("heading", { name: "Dashboard" })).toBeTruthy();

  await app.router.forward();
  expect(app.getByRole("heading", { name: "Settings" })).toBeTruthy();
});

test("router.replace は履歴を増やさない", async () => {
  const app = await renderRoute("/dashboard");
  const length = history.length;
  await app.router.replace("/dashboard/settings?tab=profile");
  expect(app.router.pathname).toBe("/dashboard/settings");
  expect(app.router.searchParams.get("tab")).toBe("profile");
  expect(history.length).toBe(length);
});

test("Client Component の useRouter().push", async () => {
  const app = await renderRoute("/dashboard/settings");
  await app.user.click(app.getByRole("button", { name: "Go home" }));
  await app.findByRole("heading", { name: "Dashboard" });
  expect(app.getByText("Path: /dashboard")).toBeTruthy();
});

test("router.refresh で Server Components が新しいデータになり、Client State は残る", async () => {
  const app = await renderRoute("/dashboard");
  expect(app.getByText("1 users")).toBeTruthy();
  await app.user.click(app.getByRole("button", { name: "Layout clicks: 0" }));
  db.users.push("Bob");
  await app.router.refresh();
  expect(app.getByText("2 users")).toBeTruthy();
  expect(app.getByRole("button", { name: "Layout clicks: 1" })).toBeTruthy();
});

test("router.prefetch", async () => {
  const app = await renderRoute("/dashboard");
  await app.router.prefetch("/users");
  await app.router.push("/users");
  expect(app.getByRole("button", { name: "Add" })).toBeTruthy();
});

test("Template は遷移で作り直される（Layout は残る）", async () => {
  const app = await renderRoute("/dashboard");
  await app.user.click(app.getByRole("button", { name: "Layout clicks: 0" }));
  await app.user.click(app.getByRole("button", { name: "Template clicks: 0" }));
  await app.router.push("/dashboard/settings");
  expect(app.getByRole("button", { name: "Layout clicks: 1" })).toBeTruthy();
  expect(app.getByRole("button", { name: "Template clicks: 0" })).toBeTruthy();
});

test("loading.tsx: 遷移中はローディング、データが届いたらページ", async () => {
  const gate = Promise.withResolvers<void>();
  db.gate = gate.promise;
  const app = await renderRoute("/dashboard");
  await app.user.click(app.getByRole("link", { name: "Slow" }));
  await app.findByText("Loading slow page");
  expect(location.pathname).toBe("/slow");
  gate.resolve();
  await app.findByRole("heading", { name: "Slow page" });
});

test("Intercepting Routes: 遷移ではモーダル、直接のアクセスではページ（仕様 9.5）", async () => {
  const app = await renderRoute("/gallery");
  await app.user.click(app.getByRole("link", { name: "Photo 1" }));
  await app.findByText("Photo 1 (modal)");
  // 遷移元のページはモーダルの後ろに残る（Parallel Routes の children スロット）
  expect(app.getByRole("heading", { name: "Gallery" })).toBeTruthy();
  expect(location.pathname).toBe("/gallery/photo/1");
  // 戻るとモーダルが閉じる
  await app.router.back();
  expect(app.queryByText("Photo 1 (modal)")).toBeNull();
  expect(location.pathname).toBe("/gallery");
  app.unmount();

  const direct = await renderRoute("/gallery/photo/1");
  expect(direct.getByRole("heading", { name: "Photo 1 (page)" })).toBeTruthy();
  expect(direct.queryByText("Photo 1 (modal)")).toBeNull();
});

test("Streaming Navigation: 遷移先の Suspense は fallback が先に出て、データが届いたら中身", async () => {
  const gate = Promise.withResolvers<void>();
  db.gate = gate.promise;
  const app = await renderRoute("/dashboard");
  await app.router.push("/stream");
  expect(app.getByRole("heading", { name: "Stream" })).toBeTruthy();
  expect(app.getByText("Loading list")).toBeTruthy();
  gate.resolve();
  await app.findByRole("listitem");
  expect(app.queryByText("Loading list")).toBeNull();
});

test("usePathname / useSearchParams / useParams / useSelectedLayoutSegment(s) は遷移に追従する", async () => {
  const app = await renderRoute("/dashboard");
  expect(app.getByText("Segment: (none)")).toBeTruthy();
  expect(app.getByText("Search: (none)")).toBeTruthy();

  await app.router.push("/dashboard/teams/blue?sort=name");
  expect(app.getByText("Path: /dashboard/teams/blue")).toBeTruthy();
  expect(app.getByText("Search: sort=name")).toBeTruthy();
  expect(app.getByText('Params: {"team":"blue"}')).toBeTruthy();
  expect(app.getByText("Segment: teams")).toBeTruthy();
  expect(app.getByText("Segments: teams/blue")).toBeTruthy();
});

test("Router Cache: 戻る / 進むはキャッシュから、Link の遷移は（dynamic の staleTime 0 なので）取り直す", async () => {
  const app = await renderRoute("/dashboard");
  await app.router.push("/dashboard/settings");
  db.users.push("Bob");
  await app.router.back();
  expect(app.getByText("1 users")).toBeTruthy();
  await app.user.click(app.getByRole("link", { name: "Settings" }));
  await app.findByRole("heading", { name: "Settings" });
  await app.user.click(app.getByRole("link", { name: "Home" }));
  await app.findByText("2 users");
});
