import { expect, test } from "bun:test";
import { join } from "node:path";

const app = join(import.meta.dir, "app");

test("Next.js の app-render で最小ページを HTML にする", async () => {
  const h = (globalThis as any).__proofyardNextHarness;
  const entryBase = (await import(h.entryBasePath)).default;
  // SSR 層の Client Component（__next_require__ で読まれる）
  const ssrLoaded = new Map<string, unknown>();
  for (const [id, path] of h.ssrModules) {
    const m = await import(path);
    ssrLoaded.set(id, m.default ?? m);
  }
  const { AppPageRouteModule, defaultConfig, setManifestsSingleton, createRequestResponseMocks, NodeNextRequest, NodeNextResponse, parseRequestHeaders } =
    (globalThis as any).__proofyardNextHarness;

  const mod = (p: string) => [() => import(p), p] as const;
  // Bun.build で ESM にした CJS は module.exports が default に入る（webpack の require と同じ形に戻す）
  const cjs = (p: string) => [async () => (await import(p)).default, p] as const;
  const tree = [
    "",
    { children: ["__PAGE__", {}, { page: mod(join(app, "page.tsx")) }, null] },
    { layout: mod(join(app, "layout.tsx")), "global-error": cjs(h.builtin("global-error")), "not-found": cjs(h.builtin("not-found")) },
    null,
  ];

  const routeModule = new AppPageRouteModule({
    definition: { kind: "APP_PAGE", page: "/page", pathname: "/", bundlePath: "", filename: "", appPaths: [] },
    userland: { loaderTree: tree },
    distDir: "",
    relativeProjectDir: "",
  });
  const ComponentMod = {
    ...entryBase,
    tree,
    routeModule,
    __next_app__: {
      require: (id: string) => {
        if (!ssrLoaded.has(id)) throw new Error(`[proofyard] unknown client module ${id}`);
        return ssrLoaded.get(id);
      },
      loadChunk: async () => {},
    },
  };
  setManifestsSingleton({
    page: "/page",
    clientReferenceManifest: {
      clientModules: Object.fromEntries([...h.clientIds].map((id: string) => [id, { id, name: "*", chunks: [], async: false }])),
      ssrModuleMapping: Object.fromEntries([...h.clientIds].map((id: string) => [id, { "*": { id, name: "*", chunks: [], async: false } }])),
      edgeSSRModuleMapping: {}, rscModuleMapping: {}, edgeRscModuleMapping: {},
      moduleLoading: { prefix: "", crossOrigin: null }, entryCSSFiles: {}, entryJSFiles: {},
    },
    serverActionsManifest: { encryptionKey: "", node: {}, edge: {} },
  });

  const nextConfig = defaultConfig;
  const { req, res } = createRequestResponseMocks({ url: "/", headers: { host: "localhost" } });
  const nextReq = new NodeNextRequest(req);
  const nextRes = new NodeNextResponse(res);
  const result = await routeModule.render(nextReq, nextRes, {
    query: {},
    params: {},
    page: "/",
    routeMatch: { resolvedPathname: "/" },
    parsedRequestHeaders: parseRequestHeaders(req.headers, { isRoutePPREnabled: false, previewModeId: undefined }),
    sharedContext: { buildId: "test", deploymentId: undefined, clientAssetToken: undefined },
    dev: undefined,
    fallbackRouteParams: null,
    renderOpts: {
      App: () => null,
      Document: () => null,
      pageConfig: {},
      ComponentMod,
      Component: ComponentMod,
      params: {},
      routeModule,
      page: "/page",
      supportsDynamicResponse: true,
      buildManifest: { polyfillFiles: [], rootMainFiles: ["static/chunks/main-app.js"], devFiles: [], lowPriorityFiles: [], pages: { "/_app": [] } },
      reactLoadableManifest: {},
      dir: process.cwd(),
      isDraftMode: false,
      isOnDemandRevalidate: false,
      isPossibleServerAction: false,
      assetPrefix: "",
      trailingSlash: nextConfig.trailingSlash,
      images: nextConfig.images,
      previewProps: { previewModeId: "x", previewModeEncryptionKey: "x", previewModeSigningKey: "x" },
      reactMaxHeadersLength: nextConfig.reactMaxHeadersLength,
      cacheLifeProfiles: nextConfig.cacheLife,
      staticPageGenerationTimeout: nextConfig.staticPageGenerationTimeout,
      basePath: "",
      cacheComponents: false,
      validationLevel: nextConfig.experimental.instantInsights?.validationLevel,
      experimental: {
        isRoutePPREnabled: false,
        expireTime: nextConfig.expireTime,
        staleTimes: nextConfig.experimental.staleTimes,
        dynamicOnHover: false,
        optimisticRouting: false,
        parallelRouteMetadata: false,
        inlineCss: false,
        prefetchInlining: false,
        authInterrupts: false,
        reactBrowserBailout: false,
        serverComponentsHmrCancellation: false,
        useCacheTimeout: nextConfig.experimental.useCacheTimeout,
        durableUseCacheEntries: false,
        cachedNavigations: false,
        clientTraceMetadata: [],
        maxPostponedStateSizeBytes: undefined,
        disableResumeDataCacheCompression: false,
        exposeTestingApi: false,
      },
      waitUntil: undefined,
      onClose: () => {},
      onAfterTaskError: () => {},
      onInstrumentationRequestError: (e: unknown) => console.error("[render error]", e),
    },
  });
  const html = await result.toUnchunkedString(true);
  console.log("status", res.statusCode);
  console.log(html.slice(0, 1500));
  expect(html).toContain("<h1>Hello from Next</h1>");
}, 30_000);
