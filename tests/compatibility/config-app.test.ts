// 仕様 24.1: tests/config-app/fixture（basePath・trailingSlash・forbidden() / unauthorized()・global-error.tsx）を本物の Next.js と比べる（bun run compat:config-app）
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { requestRoute } from "proofyard";
import { comparableFlight, comparableHtml, comparableModule, referenceModulePaths, startReference, type Reference } from "./reference";

let reference: Reference;
beforeAll(async () => {
  reference = await startReference(fixture);
}, 300_000);
afterAll(() => reference?.stop());

const cases: { path: string; cookies?: Record<string, string> }[] = [
  { path: "/base/" },
  { path: "/base" },
  { path: "/base/about" },
  { path: "/base/about/" },
  { path: "/about/" },
  { path: "/base/nope/" },
  { path: "/base/admin/" },
  { path: "/base/admin/", cookies: { role: "admin" } },
  { path: "/base/account/" },
  { path: "/base/account/", cookies: { session: "s" } },
  { path: "/base/boom/" },
  { path: "/base/api/ping/" },
  { path: "/base/api/ping" },
];
for (const { path, cookies } of cases)
  test(`requestRoute ${path}${cookies ? ` ${JSON.stringify(cookies)}` : ""} は next start と同じ`, async () => {
    const cookie = cookies && Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    const [ours, real] = await Promise.all([requestRoute(path, { cookies }), fetch(reference.url + path, { redirect: "manual", headers: { ...(cookie && { cookie }) } })]);
    expect(ours.status).toBe(real.status);
    expect(ours.headers.get("location")?.replace(/^https?:\/\/[^/]+/, "")).toBe(real.headers.get("location")?.replace(/^https?:\/\/[^/]+/, "") ?? undefined);
    expect(ours.headers.get("content-type")?.replace(/;charset=utf-8$/, "")).toBe(real.headers.get("content-type")?.replace(/;charset=utf-8$/, "") ?? undefined);
    expect(comparableHtml(await ours.text())).toBe(comparableHtml(await real.text()));
  });

const fixture = join(import.meta.dir, "../config-app/fixture");
// クライアントのナビゲーションの RSC（リクエストのときに描くルートだけ）
for (const { path, cookies } of [{ path: "/base/admin/" }, { path: "/base/account/", cookies: { session: "s" } }])
  test(`RSC ${path} は next start と同じ Flight`, async () => {
    const url = `${path}?_rsc=`;
    const cookie = cookies && Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    const ours = await requestRoute(url, { cookies, headers: { rsc: "1" } });
    const real = await fetch(reference.url + url, { redirect: "manual", headers: { rsc: "1", ...(cookie && { cookie }) } });
    expect(ours.status).toBe(real.status);
    const paths = referenceModulePaths(reference);
    const dirs = [reference.dir, fixture];
    expect(await comparableFlight(await ours.text(), (id) => comparableModule(id, dirs))).toEqual(
      await comparableFlight(await real.text(), (id) => comparableModule(paths.get(id) ?? `unknown module ${id}`, dirs)),
    );
  });
