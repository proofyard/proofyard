// 未対応のケースは通常の JS として実行せず、明示的にエラーにする（Fail Closed）
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLayer } from "../poc5/layers";

test('node_modules 内の "use cache" は変換できないのでビルドを失敗させる', async () => {
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
