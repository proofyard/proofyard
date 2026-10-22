// README の使い方: 別のアプリから proofyard を依存として使う（bunfig.toml の preload、アプリは next / react / react-dom だけ入れる）
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "../..");

test("依存として入れたアプリで動く", async () => {
  const app = mkdtempSync(join(tmpdir(), "proofyard-consumer-"));
  try {
    mkdirSync(join(app, "app"));
    mkdirSync(join(app, "node_modules"));
    symlinkSync(root, join(app, "node_modules/proofyard"));
    for (const name of ["next", "react", "react-dom"]) symlinkSync(join(root, "node_modules", name), join(app, "node_modules", name));
    writeFileSync(join(app, "bunfig.toml"), `[test]\npreload = ["proofyard/preload"]\n`);
    writeFileSync(join(app, "app/layout.tsx"), `export default function L({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n`);
    writeFileSync(join(app, "app/page.tsx"), `import { Counter } from "./counter";\nexport default function P() { return <main><h1>Consumer</h1><Counter /></main>; }\n`);
    // 分割代入は SWC が @swc/helpers の _sliced_to_array に変える（アプリには @swc/helpers がない）
    writeFileSync(
      join(app, "app/counter.tsx"),
      `"use client";\nimport { useState } from "react";\nexport function Counter() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>count {n}</button>; }\n`,
    );
    writeFileSync(
      join(app, "page.test.tsx"),
      `import { expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";
test("consumer", async () => {
  expect(await (await requestRoute("/")).text()).toContain("<h1>Consumer</h1>");
  const app = await renderRoute("/");
  await app.user.click(app.getByRole("button", { name: "count 0" }));
  await app.findByRole("button", { name: "count 1" });
});
`,
    );
    const env = { ...process.env };
    delete env.PROOFYARD_NEXT_APP;
    const proc = Bun.spawn(["bun", "test", "--timeout", "20000"], { cwd: app, env, stdout: "pipe", stderr: "pipe" });
    const output = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    expect(output).toContain("1 pass");
    expect(await proc.exited).toBe(0);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
}, 60_000);
