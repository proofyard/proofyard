// 比べるツールごとに、同じ中身のテストを N 件（FILES 個のファイルに分けて）作る。
//   bun tests/benchmarks/compare/generate.ts <N>
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import nodePath from "node:path";

const N = Number(process.argv[2] ?? 100);
const FILES = Math.min(10, N);
const { dir } = import.meta;

// 1 件のテスト: / を開き、Server Component が読んだデータ（Item 3）を確かめ、Client Component のボタンを押して表示が変わるのを待つ
const bodies = {
  // 描画しない（データの関数だけ）
  bun: {
    ext: ".test.ts",
    head: `import { expect, test } from "bun:test";\nimport { getItems } from "../../site/app/items";\n`,
    path: "generated/bun",
    test: `test(NAME, async () => {
  expect(await getItems()).toContain("Item 3");
});`,
  },
  playwright: {
    ext: ".spec.ts",
    head: `import { expect, test } from "@playwright/test";\n`,
    path: "site/bench/playwright",
    test: `test(NAME, async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Item 3")).toBeVisible();
  await page.getByRole("button", { name: "count: 0" }).click();
  await expect(page.getByRole("button", { name: "count: 1" })).toBeVisible();
});`,
  },
  proofyard: {
    ext: ".test.tsx",
    head: `import { expect, test } from "bun:test";\nimport { renderRoute } from "proofyard";\n`,
    path: "generated/proofyard",
    test: `test(NAME, async () => {
  const page = await renderRoute("/");
  expect(page.getByText("Item 3")).toBeTruthy();
  await page.user.click(page.getByRole("button", { name: "count: 0" }));
  await page.findByRole("button", { name: "count: 1" });
});`,
  },
  // Server Component は描画できないので、データを渡してクライアント側だけ（Flight もサーバーも通らない）
  rtl: {
    ext: ".test.tsx",
    head: `import { afterEach, expect, test } from "bun:test";\nimport { cleanup, render, screen } from "@testing-library/react";\nimport userEvent from "@testing-library/user-event";\nimport { ItemsView } from "../../site/app/items-view";\nimport { getItems } from "../../site/app/items";\nafterEach(cleanup);\n`,
    path: "generated/rtl",
    test: `test(NAME, async () => {
  render(<ItemsView items={await getItems()} />);
  expect(screen.getByText("Item 3")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "count: 0" }));
  await screen.findByRole("button", { name: "count: 1" });
});`,
  },
  vitest: {
    ext: ".test.tsx",
    head: `import { expect, test } from "vitest";\nimport { page } from "vitest/browser";\nimport { renderServer } from "vitest-plugin-rsc/nextjs/testing-library";\n`,
    path: "site/bench/vitest",
    test: `test(NAME, async () => {
  await renderServer({ url: "/" });
  await expect.element(page.getByText("Item 3")).toBeVisible();
  await page.getByRole("button", { name: "count: 0" }).click();
  await expect.element(page.getByRole("button", { name: "count: 1" })).toBeVisible();
});`,
  },
};

for (const { path, ext, head, test } of Object.values(bodies)) {
  const out = nodePath.join(dir, path);
  rmSync(out, { force: true, recursive: true });
  mkdirSync(out, { recursive: true });
  for (let f = 0; f < FILES; f += 1) {
    const count = Math.floor(N / FILES) + (f < N % FILES ? 1 : 0);
    const tests = Array.from({ length: count }, (_, i) =>
      test.replace("NAME", JSON.stringify(`test ${f}-${i}`))
    );
    writeFileSync(
      nodePath.join(out, `f${f}${ext}`),
      `${head}\n${tests.join("\n\n")}\n`
    );
  }
}
