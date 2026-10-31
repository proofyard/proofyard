// 仕様 24.1: tests/config-app/fixture（basePath・trailingSlash・forbidden() / unauthorized()・global-error.tsx・optimizePackageImports・reactCompiler）を本物の Next.js と比べる（bun run compat:config-app）
/* oxlint-disable no-loop-func -- reference は beforeAll で代入し、テストの中で読む */
import { afterAll, beforeAll, expect, test } from "bun:test";
import nodePath from "node:path";

import { requestRoute } from "proofyard";

import {
  comparableFlight,
  comparableHtml,
  comparableModule,
  referenceModulePaths,
  startReference,
} from "./reference";
import type { Reference } from "./reference";

const fixture = nodePath.join(import.meta.dir, "../config-app/fixture");
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
  { cookies: { role: "admin" }, path: "/base/admin/" },
  { path: "/base/account/" },
  { cookies: { session: "s" }, path: "/base/account/" },
  { path: "/base/boom/" },
  { path: "/base/api/ping/" },
  { path: "/base/api/ping" },
  { path: "/base/barrel/" },
  { path: "/base/compiler/" },
  { path: "/base/cjs/" },
  { path: "/base/tla/" },
  { path: "/base/tla-proxy/" },
  { path: "/base/tla-server/" },
  { path: "/base/api/tla/" },
];
for (const { path, cookies } of cases) {
  test(`requestRoute ${path}${cookies ? ` ${JSON.stringify(cookies)}` : ""} は next start と同じ`, async () => {
    const cookie =
      cookies &&
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    const [ours, real] = await Promise.all([
      requestRoute(path, { cookies }),
      fetch(reference.url + path, {
        headers: { ...(cookie && { cookie }) },
        redirect: "manual",
      }),
    ]);
    expect(ours.status).toBe(real.status);
    expect(
      ours.headers.get("location")?.replace(/^https?:\/\/[^/]+/u, "")
    ).toBe(
      real.headers.get("location")?.replace(/^https?:\/\/[^/]+/u, "") ??
        undefined
    );
    expect(
      ours.headers.get("content-type")?.replace(/;charset=utf-8$/u, "")
    ).toBe(
      real.headers.get("content-type")?.replace(/;charset=utf-8$/u, "") ??
        undefined
    );
    expect(comparableHtml(await ours.text())).toBe(
      comparableHtml(await real.text())
    );
  });
}

// クライアントのナビゲーションの RSC（リクエストのときに描くルートだけ）
for (const { path, cookies } of [
  { path: "/base/admin/" },
  { cookies: { session: "s" }, path: "/base/account/" },
]) {
  test(`RSC ${path} は next start と同じ Flight`, async () => {
    const url = `${path}?_rsc=`;
    const cookie =
      cookies &&
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    const ours = await requestRoute(url, { cookies, headers: { rsc: "1" } });
    const real = await fetch(reference.url + url, {
      headers: { rsc: "1", ...(cookie && { cookie }) },
      redirect: "manual",
    });
    expect(ours.status).toBe(real.status);
    const paths = referenceModulePaths(reference);
    const dirs = [reference.dir, fixture];
    expect(
      await comparableFlight(await ours.text(), (id) =>
        comparableModule(id, dirs)
      )
    ).toEqual(
      await comparableFlight(await real.text(), (id) =>
        comparableModule(paths.get(id) ?? `unknown module ${id}`, dirs)
      )
    );
  });
}
