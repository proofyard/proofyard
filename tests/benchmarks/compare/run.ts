// 仕様 20.5: 同じテスト（/ を開き、Server Component のデータを確かめ、Client Component のボタンを押す）をツールごとに測る。
//   bun tests/benchmarks/compare/run.ts [ツール名...]
// 起動: テスト 1 件。コールドはキャッシュを消して 1 回、ウォームは 3 回の中央値。100 件・1,000 件はウォーム。
// 1 件あたり = (1,000 件 - 100 件) / 900。メモリはプロセスツリー全体の PSS（共有メモリを分け合った値）のピーク（50ms ごと）と、起動したプロセス自身の最大 RSS の大きい方。
// ログは results/ にすべて残す。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const dir = import.meta.dir;
const root = resolve(dir, "../../..");
const site = join(dir, "site");
const results = join(dir, "results");
mkdirSync(results, { recursive: true });

// Chromium のシステムライブラリとフォント（root なしで ~/.cache に展開したもの。無ければそのまま）
const libs = join(process.env.HOME!, ".cache/proofyard-chromium-libs");
const chromiumEnv = { LD_LIBRARY_PATH: join(libs, "root/usr/lib/x86_64-linux-gnu"), FONTCONFIG_FILE: join(libs, "fonts.conf") };
const node = join(root, "node_modules");

type Tool = {
  name: string;
  cwd: string;
  cmd: string[];
  env?: Record<string, string>;
  // コールドの前に消すもの
  cold: () => Record<string, string> | void;
  passed: (log: string) => number | undefined;
};

const bunPassed = (log: string) => (/^ *0 fail$/m.test(log) ? Number(log.match(/^ *(\d+) pass$/m)?.[1]) : undefined);
// bun のトランスパイルのキャッシュ。コールドでは空のディレクトリにする
let bunCache = mkdtempSync(join(tmpdir(), "cmp-bun-cache-"));
const freshBunCache = () => {
  bunCache = mkdtempSync(join(tmpdir(), "cmp-bun-cache-"));
};
let proofyardCache = mkdtempSync(join(tmpdir(), "cmp-proofyard-cache-"));

const tools: Tool[] = [
  { name: "bun", cwd: root, cmd: ["bun", "test", join(dir, "generated/bun")], cold: freshBunCache, passed: bunPassed },
  { name: "rtl-happy-dom", cwd: root, cmd: ["bun", "test", "--preload", join(dir, "rtl-happy.ts"), join(dir, "generated/rtl")], cold: freshBunCache, passed: bunPassed },
  { name: "rtl-turbo-dom", cwd: root, cmd: ["bun", "test", "--preload", join(dir, "rtl-turbo.ts"), join(dir, "generated/rtl")], cold: freshBunCache, passed: bunPassed },
  {
    name: "proofyard",
    cwd: root,
    cmd: ["bun", "test", "--parallel", "--no-isolate", "--timeout", "20000", "--preload", join(root, "src/next/preload.ts"), join(dir, "generated/proofyard")],
    env: { PROOFYARD_NEXT_APP: site },
    cold: () => {
      freshBunCache();
      proofyardCache = mkdtempSync(join(tmpdir(), "cmp-proofyard-cache-"));
    },
    passed: bunPassed,
  },
  {
    name: "vitest-plugin-rsc",
    cwd: site,
    cmd: ["node", join(node, "vitest/vitest.mjs"), "run", "bench/vitest"],
    env: chromiumEnv,
    cold: () => rmSync(join(site, "node_modules/.vite"), { recursive: true, force: true }),
    passed: (log) => (/Tests +\d+ failed/.test(log) ? undefined : Number(log.match(/Tests +(\d+) passed/)?.[1])),
  },
  {
    // next start を webServer で起動する。コールドは next build から
    name: "playwright",
    cwd: site,
    cmd: ["node", join(node, "@playwright/test/cli.js"), "test", "-c", "playwright.config.ts"],
    env: chromiumEnv,
    cold: () => rmSync(join(site, ".next"), { recursive: true, force: true }),
    passed: (log) => (/\d+ failed/.test(log) ? undefined : Number(log.match(/(\d+) passed/)?.[1])),
  },
];

// プロセスツリーの PSS の合計（KB）
function treePss(rootPid: number) {
  const children = new Map<number, number[]>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      children.set(ppid, [...(children.get(ppid) ?? []), Number(entry)]);
    } catch {}
  }
  let total = 0;
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop()!;
    try {
      total += Number(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m)?.[1] ?? 0);
    } catch {}
    stack.push(...(children.get(pid) ?? []));
  }
  return total;
}

async function run(tool: Tool, label: string, expected: number, extra: string[] = []) {
  const env = { ...process.env, ...tool.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: bunCache, PROOFYARD_CACHE_DIR: proofyardCache, FORCE_COLOR: "0", NO_COLOR: "1" };
  const logFile = join(results, `${tool.name}-${label}.log`);
  let log = "";
  let peak = 0;
  const start = performance.now();
  for (const cmd of [...(extra.length ? [extra] : []), tool.cmd]) {
    const proc = Bun.spawn(cmd, { cwd: tool.cwd, env, stdout: "pipe", stderr: "pipe" });
    const timer = setInterval(() => (peak = Math.max(peak, treePss(proc.pid))), 50);
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearInterval(timer);
    // 50ms より早く終わるものは測れないので、そのプロセス自身の最大 RSS（KB）も見る
    peak = Math.max(peak, (proc.resourceUsage()?.maxRSS ?? 0) / 1024);
    log += `$ ${cmd.join(" ")}\n${out}${err}\nexit ${proc.exitCode}\n`;
    if (proc.exitCode !== 0) break;
  }
  const seconds = (performance.now() - start) / 1000;
  writeFileSync(logFile, log);
  const passed = tool.passed(log);
  if (passed !== expected) throw new Error(`${tool.name} ${label}: ${expected} 件のはずが ${passed} 件（${logFile}）`);
  console.log(`${tool.name} ${label}: ${seconds.toFixed(2)}s, ${(peak / 1024).toFixed(0)}MB`);
  return { seconds, mb: peak / 1024 };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const generate = (n: number) => Bun.spawnSync(["bun", join(dir, "generate.ts"), String(n)], { stdout: "inherit", stderr: "inherit" });
const nextBuild = ["node", join(node, "next/dist/bin/next"), "build"];

const only = process.argv.slice(2);
const selected = only.length ? tools.filter((t) => only.includes(t.name)) : tools;
// ツールを選んで測ったときは、前の結果に足す
const summaryFile = join(results, "summary.json");
const summary: Record<string, unknown> = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, "utf8")) : {};
for (const tool of selected) {
  generate(1);
  tool.cold();
  // Playwright のコールドは next build を含む
  const cold = await run(tool, "cold", 1, tool.name === "playwright" ? nextBuild : []);
  const warm = [];
  for (let i = 0; i < 3; i++) warm.push(await run(tool, `warm${i}`, 1));
  generate(100);
  const t100 = await run(tool, "100", 100);
  generate(1000);
  const t1000 = await run(tool, "1000", 1000);
  summary[tool.name] = {
    coldSeconds: cold.seconds,
    warmSeconds: median(warm.map((w) => w.seconds)),
    t100Seconds: t100.seconds,
    t1000Seconds: t1000.seconds,
    perTestMs: ((t1000.seconds - t100.seconds) / 900) * 1000,
    peakMB: Math.max(cold.mb, ...warm.map((w) => w.mb), t100.mb, t1000.mb),
  };
  writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
}
console.table(summary);
