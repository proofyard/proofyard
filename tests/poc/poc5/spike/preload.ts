// PoC 5 spike: Next.js 本体の app-render を Bun で呼ぶための環境。
require("next/dist/server/node-environment-baseline"); // globalThis.AsyncLocalStorage
// Next.js の runtime バンドル（vendored React を含む）。本番でもバンドル外で、エイリアスなしで解決される
require("next/dist/server/route-modules/app-page/module.compiled");
import { buildLayer, clientIds } from "./layers";

let t = performance.now();
const BUILTIN = "next/dist/client/components/builtin";
const rsc = await buildLayer("rsc", [
  "next/dist/server/app-render/entry-base",
  `${BUILTIN}/global-error.js`,
  `${BUILTIN}/not-found.js`,
  `${BUILTIN}/forbidden.js`,
  `${BUILTIN}/unauthorized.js`,
]);
const rscOut = (spec: string) => rsc.get(Bun.resolveSync(spec, process.cwd()))!;
console.log(`rsc layer: ${(performance.now() - t).toFixed(0)}ms, client references: ${clientIds.size}`);
t = performance.now();
const ssr = await buildLayer("ssr", [...clientIds]);
console.log(`ssr layer: ${(performance.now() - t).toFixed(0)}ms`);

(globalThis as any).__proofyardNextHarness = {
  entryBasePath: rscOut("next/dist/server/app-render/entry-base"),
  builtin: (name: string) => rscOut(`${BUILTIN}/${name}.js`),
  ssrModules: ssr,
  clientIds,
  defaultConfig: require("next/dist/server/config-shared").defaultConfig,
  setManifestsSingleton: require("next/dist/server/app-render/manifests-singleton").setManifestsSingleton,
  createRequestResponseMocks: require("next/dist/server/lib/mock-request").createRequestResponseMocks,
  ...require("next/dist/server/base-http/node"),
  parseRequestHeaders: require("next/dist/server/route-modules/app-page/parse-request-headers").parseRequestHeaders,
  AppPageRouteModule: require("next/dist/server/route-modules/app-page/module.compiled").AppPageRouteModule,
};
