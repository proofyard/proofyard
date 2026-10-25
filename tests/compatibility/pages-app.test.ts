// 仕様 24.1: tests/pages-app/fixture（Pages Router と App Router の同居）を本物の Next.js と比べる（bun run compat:pages-app）
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { requestRoute } from "proofyard";
import { comparableHtml, startReference, type Reference } from "./reference";

let reference: Reference;
beforeAll(async () => {
  reference = await startReference(join(import.meta.dir, "../pages-app/fixture"));
}, 300_000);
afterAll(() => reference?.stop());

// __NEXT_DATA__ のうち、ビルドごとに変わるもの（buildId）と、静的な HTML でだけ付くもの（nextExport、isExperimentalCompile）を除く
const nextData = (html: string) => {
  const { buildId, nextExport, isExperimentalCompile, ...data } = JSON.parse(html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/)?.[1] ?? "null") ?? {};
  return { buildId, data };
};

for (const path of ["/", "/about", "/posts/1", "/posts/7", "/posts/404", "/plain", "/redirect", "/nothing", "/hybrid"])
  test(`requestRoute ${path} は next start と同じ`, async () => {
    const headers = { cookie: "name=Alice" };
    const [ours, real] = await Promise.all([requestRoute(path, { headers }), fetch(reference.url + path, { headers, redirect: "manual" })]);
    expect(ours.status).toBe(real.status);
    expect(ours.headers.get("location")).toBe(real.headers.get("location"));
    const [ourHtml, realHtml] = [await ours.text(), await real.text()];
    expect(comparableHtml(ourHtml)).toBe(comparableHtml(realHtml));
    expect(nextData(ourHtml).data).toEqual(nextData(realHtml).data);
  });

test("/_next/data の JSON は next start と同じ", async () => {
  const realBuildId = nextData(await (await fetch(reference.url + "/")).text()).buildId;
  for (const path of ["/posts/1", "/posts/3", "/about"]) {
    const [ours, real] = await Promise.all([requestRoute(`/_next/data/proofyard${path}.json`), fetch(`${reference.url}/_next/data/${realBuildId}${path}.json`)]);
    expect(ours.status).toBe(real.status);
    expect(await ours.json()).toEqual(await real.json());
  }
});

test("API Routes は next start と同じ", async () => {
  for (const [path, method] of [["/api/hello?name=Bob", "GET"], ["/api/hello", "POST"]] as const) {
    const [ours, real] = await Promise.all([requestRoute(path, { method }), fetch(reference.url + path, { method })]);
    expect(ours.status).toBe(real.status);
    expect(await ours.json()).toEqual(await real.json());
  }
});
