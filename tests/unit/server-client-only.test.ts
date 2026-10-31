// server-only / client-only を間違った側で import すると失敗する（本物の next build もエラー）。
// Next.js 同梱の SWC が同じ文面のエラーを出す: "use client" の側は起動（層のビルド）のとき、Server Component はそのページを読み込んだとき
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

const run = async (files: Record<string, string>) => {
  const app = mkdtempSync(nodePath.join(tmpdir(), "proofyard-only-"));
  try {
    for (const [path, content] of Object.entries({
      "app/layout.tsx": `export default function L({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n`,
      ...files,
    })) {
      mkdirSync(nodePath.join(app, path, ".."), { recursive: true });
      writeFileSync(nodePath.join(app, path), content);
    }
    const proc = Bun.spawn(
      [
        "bun",
        "test",
        "--timeout",
        "20000",
        "--preload",
        nodePath.join(import.meta.dir, "../../src/next/preload.ts"),
        nodePath.join(app, "page.test.ts"),
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
    return { code: await proc.exited, output };
  } finally {
    rmSync(app, { force: true, recursive: true });
  }
};

test('"use client" から server-only を import すると起動で失敗する', async () => {
  const { output, code } = await run({
    "app/page.tsx": `import { Widget } from "./widget";\nexport default function P() { return <Widget />; }\n`,
    "app/widget.tsx": `"use client";\nimport "server-only";\nexport function Widget() { return <p>widget</p>; }\n`,
    "page.test.ts": `import { test } from "bun:test";\ntest("never", () => {});\n`,
  });
  expect(output).toContain(
    `You're importing a module that depends on "server-only" into a React Client Component module`
  );
  expect(code).not.toBe(0);
}, 60_000);

test("Server Component から client-only を import すると、そのページは 500", async () => {
  const { output, code } = await run({
    "app/page.tsx": `import "client-only";\nexport default function P() { return <p>bad</p>; }\n`,
    "page.test.ts": `import { expect, test } from "bun:test";\nimport { requestRoute } from ${JSON.stringify(nodePath.join(import.meta.dir, "../../src/index.ts"))};\ntest("page", async () => expect((await requestRoute("/")).status).toBe(500));\n`,
  });
  expect(output).toContain(
    `You're importing a component that imports client-only`
  );
  expect(output).toContain("1 pass");
  expect(code).toBe(0);
}, 60_000);
