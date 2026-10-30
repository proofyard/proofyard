# Changelog

## [0.1.4](https://github.com/proofyard/proofyard/compare/v0.1.3...v0.1.4) (2026-10-30)


### Performance Improvements

* build the route bundle after the ssr build again; sort client references so cache keys are stable; log cache misses with PROOFYARD_DEBUG ([659f7b8](https://github.com/proofyard/proofyard/commit/659f7b82bef82fe29457653dc7bc2607e0eb99f3))
* compare app files by content so touching them keeps the cache ([794dd96](https://github.com/proofyard/proofyard/commit/794dd96ef96a61eb232004ace8ed4c2386994195))
* let the prerender process and parallel workers reuse the layers and node_modules traversal ([bf49fa7](https://github.com/proofyard/proofyard/commit/bf49fa7ae185e943cbc33b33891a677d7aee81f2))
* name generated entries and order rsc entries by route so the cache key is stable ([bf73211](https://github.com/proofyard/proofyard/commit/bf732117e75188604005312606a882ea57075fd3))
* read files asynchronously in the layer build plugins ([4d57391](https://github.com/proofyard/proofyard/commit/4d573918c4c49414a4845440c5167ecb45d1786e))
* read node_modules files concurrently while tracing imports ([88ab9e1](https://github.com/proofyard/proofyard/commit/88ab9e13cd70b605f8fd678ec1759fc805819fa0))
* reuse layer bundles, node_modules traversal and prerender results across runs ([e5af54e](https://github.com/proofyard/proofyard/commit/e5af54e3fee9f57d0b61c69db3259e8a5f7fb27a))
* start the browser build alongside the ssr build; show the startup breakdown only with PROOFYARD_DEBUG ([e1e9f11](https://github.com/proofyard/proofyard/commit/e1e9f112eac9d13aafa6da2a9dc2f4ba9beebf59))
* start the route build alongside the ssr build; show plugin JS time with PROOFYARD_DEBUG ([2fab1b0](https://github.com/proofyard/proofyard/commit/2fab1b06825fb7fc5757f3836d06f900c334a878))

## [0.1.3](https://github.com/proofyard/proofyard/compare/v0.1.2...v0.1.3) (2026-10-29)


### Performance Improvements

* avoid catastrophic backtracking in USE_CLIENT directive regex ([0de9d60](https://github.com/proofyard/proofyard/commit/0de9d6075b71302cf0611536a4a35ce1a42bb67e))
* resolve react-server imports once per package and skip relative imports ([f796bd4](https://github.com/proofyard/proofyard/commit/f796bd46a37888c2bd050232be487c52d9b01945))

## [0.1.2](https://github.com/proofyard/proofyard/compare/v0.1.1...v0.1.2) (2026-10-29)


### Bug Fixes

* accept DOM events on EventTargets created before the DOM is installed ([377bf67](https://github.com/proofyard/proofyard/commit/377bf677439304cb50af9b32f81f4ddf6e985d11))
* load app-local node_modules as-is and prepare barrels for Client Components ([49ff4ff](https://github.com/proofyard/proofyard/commit/49ff4ff67f15acccd4565308ab4ad22aecbd6182))
* load server entries that depend on top-level await ([14712c9](https://github.com/proofyard/proofyard/commit/14712c94956ec0f01a94eaaa067fd41ecd3ef1f2))
* support Client Components that depend on top-level await ([479b2e7](https://github.com/proofyard/proofyard/commit/479b2e75aae65738a47f28417e56df4c1b8bf9f0))

## [0.1.1](https://github.com/proofyard/proofyard/compare/v0.1.0...v0.1.1) (2026-10-28)


### Bug Fixes

* accept Next.js 16.4 patches from 16.4.2 (16.4.3 was rejected at startup) ([c6aa1f3](https://github.com/proofyard/proofyard/commit/c6aa1f366b952bfd4a77d56a2846dcc3bdd53793))
* support optimizePackageImports, React Compiler and symlinked TMPDIR ([99d12fa](https://github.com/proofyard/proofyard/commit/99d12fa31273df935cd0dcf6dd0781b8f9c0f618))
