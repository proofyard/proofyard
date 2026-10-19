// PoC 3: turbo-dom と happy-dom の比較。DOM 実装ごとに別プロセスで実行する。
//   PROOFYARD_DOM=turbo bun run bench:dom
//   PROOFYARD_DOM=happy bun run bench:dom
import { expect, test } from "bun:test";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-server-dom-turbopack/server";
import { CLIENT, clientModules } from "../poc/poc2/plugin";
import { InteractivePage } from "../poc/poc3/fixtures/pages";

const impl = process.env.PROOFYARD_DOM ?? "turbo";
const N = Number(process.env.PROOFYARD_N ?? 300);
const html = "<!doctype html><html><head></head><body></body></html>";

let t = performance.now();
if (impl === "turbo") {
  const { installGlobals } = await import("@miaskiewicz/turbo-dom/install");
  installGlobals(globalThis, { html });
} else {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  GlobalRegistrator.register();
  document.write(html);
}
const setupMs = performance.now() - t;

const flight = await import(join(import.meta.dir, "../poc/poc2/client-runtime.ts") + CLIENT);
const rtl = await import(join(import.meta.dir, "../poc/poc3/dom-runtime.ts") + CLIENT);

async function rsc(node: ReactNode) {
  const ids = [...clientModules];
  const stream = renderToReadableStream(node, Object.fromEntries(ids.map((id) => [id, { id, chunks: [], name: "*" }])));
  await flight.loadClientModules(clientModules);
  return flight.decode(stream, {
    moduleMap: Object.fromEntries(ids.map((id) => [id, { "*": { id, chunks: [], name: "*" } }])),
    serverModuleMap: null,
    moduleLoading: null,
  });
}

// 1回分のテストに相当する処理: 描画 → クエリ → クリック → 入力 → 後片付け
async function once(tree: ReactNode) {
  rtl.render(tree);
  const user = rtl.userEvent.setup({ delay: null }); // 待ち時間を除いて DOM の差を見る
  await user.click(rtl.screen.getByRole("button", { name: /Clicks/ }));
  await user.type(rtl.screen.getByLabelText("Name"), "Al");
  expect(rtl.screen.getByRole("dialog")).toBeTruthy();
  rtl.cleanup();
}

const ms = (n: number) => `${n.toFixed(2)}ms`;

test(`dom benchmark: ${impl}`, async () => {
  t = performance.now();
  await once(await rsc(<InteractivePage />));
  const firstMs = performance.now() - t;

  // DOM 部分だけ（デコード済みのツリーを使い回す）
  const tree = await rsc(<InteractivePage />);
  for (let i = 0; i < 20; i++) await once(tree); // ウォームアップ
  t = performance.now();
  for (let i = 0; i < N; i++) await once(tree);
  const domMs = (performance.now() - t) / N;

  // RSC → Flight → デコード → DOM まで通し
  t = performance.now();
  for (let i = 0; i < N; i++) await once(await rsc(<InteractivePage />));
  const fullMs = (performance.now() - t) / N;

  const rss = process.memoryUsage().rss / 1024 / 1024;
  console.log(
    `RESULT ${impl}: setup=${ms(setupMs)} first=${ms(firstMs)} dom/iter=${ms(domMs)} full/iter=${ms(fullMs)} rss=${rss.toFixed(0)}MB (N=${N})`,
  );
}, 120_000);
