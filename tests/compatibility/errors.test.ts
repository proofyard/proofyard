// 仕様 24.1: エラー、notFound()、redirect() を本物の Next.js と比べる（tests/poc/poc5/fixture-app。bun run compat:errors）
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { requestRoute } from "proofyard";
import { comparableFlight, comparableHtml, comparableModule, referenceModulePaths, startReference, type Reference } from "./reference";

const fixture = join(import.meta.dir, "../poc/poc5/fixture-app");
let reference: Reference;
beforeAll(async () => {
  reference = await startReference(fixture);
}, 300_000);
afterAll(() => reference?.stop());

const cases: { path: string; cookies?: Record<string, string>; prerendered?: boolean }[] = [
  { path: "/dashboard/users/1?tab=likes", cookies: { theme: "dark" } },
  // error.tsx（Error Boundary）
  { path: "/dashboard/users/boom" },
  // not-found.tsx
  { path: "/dashboard/users/missing" },
  // Error Boundary なし（global-error）
  { path: "/profile?id=1" },
  // RSC は比べない: next start は build のときの RSC（最初の HTML 用の形）を返す
  { path: "/go", prerendered: true },
  { path: "/nothing-here", prerendered: true },
];
// dashboard のレイアウトは User-Agent を表示する（fetch は自動で付ける）
const userAgent = "proofyard-compat";
for (const { path, cookies, prerendered } of cases) {
  const cookie = cookies && Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  test(`requestRoute ${path} は next start と同じ`, async () => {
    const ours = await requestRoute(path, { cookies, headers: { "user-agent": userAgent } });
    const real = await fetch(reference.url + path, { redirect: "manual", headers: { "user-agent": userAgent, ...(cookie && { cookie }) } });
    expect(ours.status).toBe(real.status);
    expect(ours.headers.get("location")).toBe(real.headers.get("location"));
    expect(comparableHtml(await ours.text())).toBe(comparableHtml(await real.text()));
  });
  if (!prerendered)
    test(`RSC ${path} は next start と同じ Flight`, async () => {
      const url = `${path}${path.includes("?") ? "&" : "?"}_rsc=`;
      const ours = await requestRoute(url, { cookies, headers: { rsc: "1", "user-agent": userAgent } });
      const real = await fetch(reference.url + url, { redirect: "manual", headers: { rsc: "1", "user-agent": userAgent, ...(cookie && { cookie }) } });
      expect(real.headers.get("x-nextjs-prerender")).toBeNull();
      expect(ours.status).toBe(real.status);
      const paths = referenceModulePaths(reference);
      const dirs = [fixture, reference.dir];
      expect(await comparableFlight(await ours.text(), (id) => comparableModule(id, dirs))).toEqual(
        await comparableFlight(await real.text(), (id) => comparableModule(paths.get(id) ?? `unknown module ${id}`, dirs)),
      );
    });
}
