// PoC 3（仕様22章）: Bun + React 19 + turbo-dom で Client Mode を動かす。
// RSC → Flight → Client Graph でデコード → react-dom/client（createRoot / hydrateRoot）→ turbo-dom
// `bun run test:poc3` で実行する。このファイル自体は Server Graph で動く。
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-server-dom-turbopack/server";
import { installGlobals } from "@miaskiewicz/turbo-dom/install";
import { CLIENT, clientModules } from "../poc2/plugin";
import { HydrationPage, InteractivePage, StreamingPage } from "./fixtures/pages";

// Client Graph の react-dom/client を読む前に DOM を用意する
installGlobals(globalThis, { html: "<!doctype html><html><head></head><body></body></html>" });

const flight = await import(join(import.meta.dir, "../poc2/client-runtime.ts") + CLIENT);
const rtl = await import(join(import.meta.dir, "dom-runtime.ts") + CLIENT);
const widgets = await import(join(import.meta.dir, "fixtures/widgets.tsx") + CLIENT);

afterEach(() => {
  rtl.cleanup();
  widgets.effects.length = 0;
});

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

// Server → Flight（ストリームのまま）→ Client Graph の React ツリー
async function rsc(node: ReactNode) {
  const m = manifests();
  const errors: unknown[] = [];
  const stream = renderToReadableStream(node, m.client, { onError: (e: unknown) => void errors.push(e) });
  await flight.loadClientModules(clientModules);
  return { tree: await flight.decode(stream, m.consumer), errors };
}

test("createRoot: useState / useEffect / useLayoutEffect と DOM イベント", async () => {
  const { tree, errors } = await rsc(<InteractivePage />);
  rtl.render(tree);
  expect(errors).toEqual([]);

  const button = rtl.screen.getByRole("button", { name: "Clicks: 0" });
  expect(widgets.effects).toEqual(["layout:0", "effect:0"]);

  await rtl.userEvent.click(button);
  expect(button.textContent).toBe("Clicks: 1");
  expect(widgets.effects).toEqual(["layout:0", "effect:0", "layout:1", "cleanup:0", "effect:1"]);
});

test("フォーム: user-event で入力して送信する", async () => {
  const { tree } = await rsc(<InteractivePage />);
  rtl.render(tree);
  const user = rtl.userEvent.setup();
  await user.type(rtl.screen.getByLabelText("Name"), "Alice");
  await user.click(rtl.screen.getByRole("button", { name: "Greet" }));
  expect(rtl.screen.getByText("Hello, Alice")).toBeTruthy();
});

test("Portal: document.body 直下に描画される", async () => {
  const { tree } = await rsc(<InteractivePage />);
  rtl.render(tree);
  const dialog = rtl.screen.getByRole("dialog");
  expect(dialog.textContent).toBe("Portal content");
  expect(dialog.parentNode).toBe(document.body);
});

test("Suspense: Server から渡した Promise を Client で use() し、解決後に表示が変わる", async () => {
  let resolve!: (v: string) => void;
  const user = new Promise<string>((r) => (resolve = r));
  const { tree } = await rsc(<StreamingPage user={user} />);
  // React のテスト環境では、サスペンドを伴う描画と再開は await した act() の中で進める
  await rtl.act(async () => void rtl.render(tree));
  expect(rtl.screen.getByText("Loading...")).toBeTruthy();

  // Flight ストリームが続きを送り、Client の Suspense が解ける
  await rtl.act(async () => resolve("Alice"));
  expect(rtl.screen.getByText("User: Alice")).toBeTruthy();
  expect(rtl.screen.queryByText("Loading...")).toBeNull();
});

test("テスト間の分離: 前のテストの DOM が残っていない", () => {
  expect(document.body.innerHTML).toBe("");
  expect(widgets.effects).toEqual([]);
});

test("hydrateRoot: SSR の HTML をハイドレートし、イベントが効く", async () => {
  (globalThis as any).__phase = "same";
  const { tree } = await rsc(<HydrationPage />);
  const container = document.createElement("div");
  container.innerHTML = await flight.html(tree);
  document.body.appendChild(container);
  const serverButton = container.querySelector("button");

  const recoverable: unknown[] = [];
  await rtl.act(async () => {
    rtl.hydrateRoot(container, tree, { onRecoverableError: (e: unknown) => void recoverable.push(e) });
  });
  expect(recoverable).toEqual([]);
  // SSR の DOM ノードがそのまま再利用されている
  expect(container.querySelector("button")).toBe(serverButton);

  await rtl.userEvent.click(serverButton!);
  expect(serverButton!.textContent).toBe("Hydrated: 1");
  container.remove();
});

test("hydrateRoot: Hydration Mismatch を onRecoverableError で検出する", async () => {
  const { tree } = await rsc(<HydrationPage />);
  (globalThis as any).__phase = "server";
  const container = document.createElement("div");
  container.innerHTML = await flight.html(tree);
  document.body.appendChild(container);

  (globalThis as any).__phase = "client";
  const recoverable: Error[] = [];
  await rtl.act(async () => {
    rtl.hydrateRoot(container, tree, { onRecoverableError: (e: Error) => void recoverable.push(e) });
  });
  expect(String(recoverable[0]?.message)).toMatch(/Hydration failed|didn't match/);
  expect(container.textContent).toContain("client"); // Client の描画で置き換わる
  container.remove();
});
