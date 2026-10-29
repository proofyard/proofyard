# Changelog

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
