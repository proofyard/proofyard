// 未対応のケースは通常の JS として実行せず、明示的にエラーにする（Fail Closed）
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLayer } from "../../../src/next/layers";

// rsc 層のバンドルは Next.js 本体だけ（アプリと node_modules はネイティブで読み込み、"use cache" はそこで変換する）。
// 変換を通らずにバンドルに入れば、ビルドを失敗させる
test('rsc 層のバンドルに入った node_modules の "use cache" はビルドを失敗させる', async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofyard-unsupported-"));
  mkdirSync(join(dir, "node_modules/cached-lib"), { recursive: true });
  writeFileSync(join(dir, "node_modules/cached-lib/index.js"), `export async function load() {\n  "use cache";\n  return 1;\n}\n`);
  writeFileSync(join(dir, "entry.js"), `export { load } from "cached-lib";\n`);
  const error = await buildLayer("rsc", [join(dir, "entry.js")], { define: { "process.env.NODE_ENV": '"production"' } }).catch((e) => e);
  expect(error).toBeInstanceOf(AggregateError);
  expect(String(error.errors.map((e: { message: string }) => e.message))).toContain(
    'Unsupported Next.js feature: "use server" / "use cache" in node_modules is not compiled by the current runtime',
  );
});

// "use server" の CommonJS は Next.js の SWC の変換がどう扱うかを確かめていない（"use client" の CommonJS は対応。tests/unit/advanced.test.tsx）
for (const directive of ["use server"])
  test(`node_modules の CommonJS の "${directive}" は未対応。サーバーで実行せず、読み込んだときに失敗させる`, async () => {
    const app = mkdtempSync(join(tmpdir(), "proofyard-third-party-client-"));
    mkdirSync(join(app, "app"));
    mkdirSync(join(app, "node_modules/fake-ui"), { recursive: true });
    writeFileSync(join(app, "node_modules/fake-ui/package.json"), JSON.stringify({ name: "fake-ui", main: "index.js" }));
    writeFileSync(join(app, "node_modules/fake-ui/index.js"), `"${directive}";\nexports.Button = async function Button() { return null; };\n`);
    writeFileSync(join(app, "app/layout.tsx"), `export default function L({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n`);
    writeFileSync(join(app, "app/page.tsx"), `import { Button } from "fake-ui";\nexport default function P() { return <Button />; }\n`);
    writeFileSync(
      join(app, "page.test.ts"),
      `import { expect, test } from "bun:test";\ntest("page", async () => {\n  await expect(import("./app/page.tsx")).rejects.toThrow('Unsupported: CommonJS "${directive}" ');\n});\n`,
    );
    const proc = Bun.spawn(["bun", "test", "--preload", join(import.meta.dir, "../../../src/next/preload.ts"), join(app, "page.test.ts")], {
      cwd: process.cwd(),
      env: { ...process.env, PROOFYARD_NEXT_APP: app },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    expect(output).toContain("1 pass");
    expect(await proc.exited).toBe(0);
  }, 60_000);

test("同じプロセスで同時に動くテスト（test.concurrent）は、DOM とキャッシュを分けられないので Fail Closed", async () => {
  const app = mkdtempSync(join(tmpdir(), "proofyard-concurrent-"));
  mkdirSync(join(app, "app"));
  writeFileSync(join(app, "app/layout.tsx"), `export default function L({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n`);
  writeFileSync(join(app, "app/page.tsx"), `export default function P() { return <p>home</p>; }\n`);
  writeFileSync(
    join(app, "page.test.ts"),
    `import { test } from "bun:test";\nfor (const name of ["a", "b"]) test.concurrent(name, () => Bun.sleep(50));\n`,
  );
  const proc = Bun.spawn(["bun", "test", "--preload", join(import.meta.dir, "../../../src/next/preload.ts"), join(app, "page.test.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, PROOFYARD_NEXT_APP: app },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  expect(output).toContain("Unsupported: concurrent tests in one process");
  expect(output).toContain("1 fail");
  expect(await proc.exited).toBe(1);
}, 60_000);
