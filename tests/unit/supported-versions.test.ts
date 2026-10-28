import { expect, test } from "bun:test";
import pkg from "../../package.json";

// プリロードが起動時に確かめる Next.js の範囲（peerDependencies）: 16.4 のパッチ版だけ
test("supported Next.js versions are 16.4 patches from 16.4.2", () => {
  const range = pkg.peerDependencies.next;
  for (const v of ["16.4.2", "16.4.3", "16.4.10"]) expect(Bun.semver.satisfies(v, range)).toBe(true);
  for (const v of ["16.4.1", "16.5.0", "16.5.0-canary.1", "16.4.3-canary.0", "17.0.0"]) expect(Bun.semver.satisfies(v, range)).toBe(false);
});
