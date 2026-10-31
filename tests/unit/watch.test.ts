// bun test --watch: アプリのファイル（Server Component が読むもの、Client Component）を変えると、テストが再実行されて変更が反映される。
// Bun はランタイムのプラグインで読んだファイルと、層のバンドルにだけ入るファイルを監視しないので、プリロードが監視させている
import { expect, test } from "bun:test";
import { mkdtempDisposableSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("bun test --watch は、Server Component が読むファイルと Client Component の変更で再実行する", async () => {
  using tmp = mkdtempDisposableSync(path.join(tmpdir(), "proofyard-watch-"));
  const app = tmp.path;
  mkdirSync(path.join(app, "app"));
  writeFileSync(
    path.join(app, "app/layout.tsx"),
    `export default function L({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n`
  );
  writeFileSync(
    path.join(app, "app/message.ts"),
    `export const message = "server 1";\n`
  );
  writeFileSync(
    path.join(app, "app/label.tsx"),
    `"use client";\nexport function Label() { return <span>client 1</span>; }\n`
  );
  writeFileSync(
    path.join(app, "app/page.tsx"),
    `import { message } from "./message";\nimport { Label } from "./label";\nexport default function P() { return <p>{message} <Label /></p>; }\n`
  );
  writeFileSync(
    path.join(app, "page.test.ts"),
    `import { test } from "bun:test";\nimport { renderRoute } from ${JSON.stringify(path.join(import.meta.dir, "../../src/index.ts"))};\ntest("page", async () => {\n  const page = await renderRoute("/");\n  console.log("RENDERED", (await page.findByText(/client/)).parentElement!.textContent);\n});\n`
  );
  const proc = Bun.spawn(
    [
      "bun",
      "test",
      "--watch",
      "--timeout",
      "20000",
      "--preload",
      path.join(import.meta.dir, "../../src/next/preload.ts"),
      path.join(app, "page.test.ts"),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PROOFYARD_NEXT_APP: app },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  let output = "";
  const collect = async (stream: typeof proc.stdout) => {
    for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
      output += chunk;
    }
  };
  for (const stream of [proc.stdout, proc.stderr]) {
    collect(stream);
  }
  const rendered = async (count: number) => {
    while ([...output.matchAll(/^RENDERED (?<text>.*)$/gmu)].length < count) {
      if (
        proc.exitCode !== null ||
        /^ *[1-9]\d* (?:fail|error)$/mu.test(output)
      ) {
        throw new Error(output);
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- 出力が揃うまで待つ
      await Bun.sleep(100);
    }
    return [...output.matchAll(/^RENDERED (?<text>.*)$/gmu)].map((m) => m[1]);
  };
  try {
    expect(await rendered(1)).toEqual(["server 1 client 1"]);
    writeFileSync(
      path.join(app, "app/message.ts"),
      `export const message = "server 2";\n`
    );
    expect(await rendered(2)).toEqual([
      "server 1 client 1",
      "server 2 client 1",
    ]);
    writeFileSync(
      path.join(app, "app/label.tsx"),
      `"use client";\nexport function Label() { return <span>client 2</span>; }\n`
    );
    expect(await rendered(3)).toEqual([
      "server 1 client 1",
      "server 2 client 1",
      "server 2 client 2",
    ]);
  } finally {
    proc.kill();
    await proc.exited;
  }
}, 120_000);
