// 仕様 24.1: tests/src-app/fixture（src/ ディレクトリと tsconfig の paths）を本物の Next.js と比べる（bun run compat:src-app）
import { afterAll, beforeAll, expect, test } from "bun:test";
import nodePath from "node:path";

import { requestRoute } from "proofyard";

import { comparableHtml, startReference } from "./reference";
import type { Reference } from "./reference";

let reference: Reference;
beforeAll(async () => {
  // /boom は next build のエラー（例外を投げるページ）
  reference = await startReference(
    nodePath.join(import.meta.dir, "../src-app/fixture"),
    { exclude: ["src/app/boom"] }
  );
}, 300_000);
afterAll(() => reference?.stop());

for (const path of ["/", "/about"]) {
  // oxlint-disable-next-line no-loop-func -- reference は beforeAll で代入し、テストの中で読む
  test(`requestRoute ${path} は next start と同じ`, async () => {
    const [ours, real] = await Promise.all([
      requestRoute(path),
      fetch(reference.url + path),
    ]);
    expect(ours.status).toBe(real.status);
    expect(ours.headers.get("x-src-proxy")).toBe(
      real.headers.get("x-src-proxy")
    );
    expect(comparableHtml(await ours.text())).toBe(
      comparableHtml(await real.text())
    );
  });
}
