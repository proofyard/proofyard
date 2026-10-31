// ファイルの直下の mock.module は、次のファイルに残らない（bun test は既定で全部のファイルを 1 つのプロセスで動かす）
import { expect, test } from "bun:test";
import { mkdtempDisposableSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("前のファイルの mock.module は次のファイルに残らない", async () => {
  using tmp = mkdtempDisposableSync(
    path.join(tmpdir(), "proofyard-mock-files-")
  );
  const app = tmp.path;
  mkdirSync(path.join(app, "app"));
  writeFileSync(
    path.join(app, "app/layout.tsx"),
    `export default function L({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n`
  );
  writeFileSync(
    path.join(app, "app/page.tsx"),
    `export default function P() { return <p>home</p>; }\n`
  );
  writeFileSync(
    path.join(app, "next.test.ts"),
    `import { expect, test } from "bun:test";\nimport { greeting } from ${JSON.stringify(path.join(import.meta.dir, "mocks/greeting"))};\ntest("next file", () => expect(greeting()).toBe("real"));\n`
  );
  // 順番はコマンドラインのとおり
  const proc = Bun.spawn(
    [
      "bun",
      "test",
      "--preload",
      path.join(import.meta.dir, "../../src/next/preload.ts"),
      path.join(import.meta.dir, "mock.test.ts"),
      path.join(app, "next.test.ts"),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PROOFYARD_NEXT_APP: app },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const output =
    (await new Response(proc.stdout).text()) +
    (await new Response(proc.stderr).text());
  expect(output).toContain("6 pass");
  expect(output).toContain("0 fail");
  expect(await proc.exited).toBe(0);
}, 60_000);
