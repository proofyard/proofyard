// ファイルの直下の mock.module は、次のファイルに残らない（bun test は既定で全部のファイルを 1 つのプロセスで動かす）
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("前のファイルの mock.module は次のファイルに残らない", async () => {
  const app = mkdtempSync(join(tmpdir(), "proofyard-mock-files-"));
  mkdirSync(join(app, "app"));
  writeFileSync(join(app, "app/layout.tsx"), `export default function L({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n`);
  writeFileSync(join(app, "app/page.tsx"), `export default function P() { return <p>home</p>; }\n`);
  writeFileSync(
    join(app, "next.test.ts"),
    `import { expect, test } from "bun:test";\nimport { greeting } from ${JSON.stringify(join(import.meta.dir, "mocks/greeting"))};\ntest("next file", () => expect(greeting()).toBe("real"));\n`,
  );
  // 順番はコマンドラインのとおり
  const proc = Bun.spawn(["bun", "test", "--preload", join(import.meta.dir, "../../src/next/preload.ts"), join(import.meta.dir, "mock.test.ts"), join(app, "next.test.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, PROOFYARD_NEXT_APP: app },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  expect(output).toContain("6 pass");
  expect(output).toContain("0 fail");
  expect(await proc.exited).toBe(0);
}, 60_000);
