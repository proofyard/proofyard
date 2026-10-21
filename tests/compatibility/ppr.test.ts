// 仕様 24.1: tests/ppr/fixture を本物の Next.js と比べる（bun run compat:ppr。next build を含むので遅い）
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { prerenderRoute, requestRoute } from "proofyard";
import { comparableHtml, startReference, type Reference } from "./reference";

let reference: Reference;
beforeAll(async () => {
  // /blocking は next build のエラー（同じエラーになることは tests/ppr）
  reference = await startReference(join(import.meta.dir, "../ppr/fixture"), { exclude: ["app/blocking"] });
}, 300_000);
afterAll(() => reference?.stop());

for (const path of ["/dashboard", "/about", "/posts/hello", "/products/1", "/private"])
  test(`requestRoute ${path} は next start と同じ HTML`, async () => {
    const [ours, real] = await Promise.all([requestRoute(path), fetch(reference.url + path)]);
    expect(ours.status).toBe(real.status);
    expect(comparableHtml(await ours.text())).toBe(comparableHtml(await real.text()));
  });

for (const path of ["/dashboard", "/about", "/posts/hello", "/products/[id]", "/private"])
  test(`prerenderRoute ${path} は next build の静的シェル（.html）と同じ`, async () => {
    const result = await prerenderRoute(path);
    const html = await Bun.file(join(reference.dir, ".next/server/app", `${path}.html`)).text();
    // next build の .html は、動的な部分があれば閉じタグなし（続きは resume で流れる）
    const withoutClosingTags = (html: string) => comparableHtml(html).replace(/<\/body><\/html>$/, "");
    expect(withoutClosingTags(result.shell)).toBe(withoutClosingTags(html));
  });
