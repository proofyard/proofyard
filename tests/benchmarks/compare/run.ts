// 仕様 20.5: 同じテスト（/ を開き、Server Component のデータを確かめ、Client Component のボタンを押す）をツールごとに測る。
//   bun tests/benchmarks/compare/run.ts [ツール名...]
// 起動: テスト 1 件。コールドはキャッシュを消して 1 回、ウォームは 3 回の中央値。100 件・1,000 件はウォーム。
// 1 件あたり = (1,000 件 - 100 件) / 900。メモリはプロセスツリー全体の PSS（共有メモリを分け合った値）のピーク（50ms ごと）と、起動したプロセス自身の最大 RSS の大きい方。
// ログは results/ にすべて残す。
/* oxlint-disable no-await-in-loop -- ツールと件数ごとに順番に測る */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

const { dir } = import.meta;
const root = nodePath.resolve(dir, "../../..");
const site = nodePath.join(dir, "site");
const results = nodePath.join(dir, "results");
mkdirSync(results, { recursive: true });

// Chromium のシステムライブラリとフォント（root なしで ~/.cache に展開したもの。無ければそのまま）
// oxlint-disable-next-line typescript/no-non-null-assertion -- HOME がなければ例外で止まってよい
const libs = nodePath.join(process.env.HOME!, ".cache/proofyard-chromium-libs");
const chromiumEnv = {
  FONTCONFIG_FILE: nodePath.join(libs, "fonts.conf"),
  LD_LIBRARY_PATH: nodePath.join(libs, "root/usr/lib/x86_64-linux-gnu"),
};
const node = nodePath.join(root, "node_modules");

interface Tool {
  name: string;
  cwd: string;
  cmd: string[];
  env?: Record<string, string>;
  // コールドの前に消すもの
  cold: () => unknown;
  passed: (log: string) => number | undefined;
}

const bunPassed = (log: string) =>
  /^ *0 fail$/mu.test(log)
    ? Number(log.match(/^ *(?<count>\d+) pass$/mu)?.[1])
    : undefined;
// bun のトランスパイルのキャッシュ。コールドでは空のディレクトリにする
let bunCache = mkdtempSync(nodePath.join(tmpdir(), "cmp-bun-cache-"));
const freshBunCache = () => {
  bunCache = mkdtempSync(nodePath.join(tmpdir(), "cmp-bun-cache-"));
};
let proofyardCache = mkdtempSync(
  nodePath.join(tmpdir(), "cmp-proofyard-cache-")
);

const tools: Tool[] = [
  {
    cmd: ["bun", "test", nodePath.join(dir, "generated/bun")],
    cold: freshBunCache,
    cwd: root,
    name: "bun",
    passed: bunPassed,
  },
  {
    cmd: [
      "bun",
      "test",
      "--preload",
      nodePath.join(dir, "rtl-happy.ts"),
      nodePath.join(dir, "generated/rtl"),
    ],
    cold: freshBunCache,
    cwd: root,
    name: "rtl-happy-dom",
    passed: bunPassed,
  },
  {
    cmd: [
      "bun",
      "test",
      "--preload",
      nodePath.join(dir, "rtl-turbo.ts"),
      nodePath.join(dir, "generated/rtl"),
    ],
    cold: freshBunCache,
    cwd: root,
    name: "rtl-turbo-dom",
    passed: bunPassed,
  },
  {
    cmd: [
      "bun",
      "test",
      "--parallel",
      "--no-isolate",
      "--timeout",
      "20000",
      "--preload",
      nodePath.join(root, "src/next/preload.ts"),
      nodePath.join(dir, "generated/proofyard"),
    ],
    cold: () => {
      freshBunCache();
      proofyardCache = mkdtempSync(
        nodePath.join(tmpdir(), "cmp-proofyard-cache-")
      );
    },
    cwd: root,
    env: { PROOFYARD_NEXT_APP: site },
    name: "proofyard",
    passed: bunPassed,
  },
  {
    cmd: [
      "node",
      nodePath.join(node, "vitest/vitest.mjs"),
      "run",
      "bench/vitest",
    ],
    cold: () =>
      rmSync(nodePath.join(site, "node_modules/.vite"), {
        force: true,
        recursive: true,
      }),
    cwd: site,
    env: chromiumEnv,
    name: "vitest-plugin-rsc",
    passed: (log) =>
      /Tests +\d+ failed/u.test(log)
        ? undefined
        : Number(log.match(/Tests +(?<count>\d+) passed/u)?.[1]),
  },
  {
    // next start を webServer で起動する。コールドは next build から
    cmd: [
      "node",
      nodePath.join(node, "@playwright/test/cli.js"),
      "test",
      "-c",
      "playwright.config.ts",
    ],
    cold: () =>
      rmSync(nodePath.join(site, ".next"), { force: true, recursive: true }),
    cwd: site,
    env: chromiumEnv,
    name: "playwright",
    passed: (log) =>
      /\d+ failed/u.test(log)
        ? undefined
        : Number(log.match(/(?<count>\d+) passed/u)?.[1]),
  },
];

// プロセスツリーの PSS の合計（KB）
const treePss = (rootPid: number) => {
  const children = new Map<number, number[]>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/u.test(entry)) {
      continue;
    }
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf-8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      children.set(ppid, [...(children.get(ppid) ?? []), Number(entry)]);
    } catch {
      // 読む前に終わったプロセスは数えない
    }
  }
  let total = 0;
  const stack = [rootPid];
  for (let pid = stack.pop(); pid !== undefined; pid = stack.pop()) {
    try {
      total += Number(
        readFileSync(`/proc/${pid}/smaps_rollup`, "utf-8").match(
          /^Pss:\s+(?<kb>\d+)/mu
        )?.[1] ?? 0
      );
    } catch {
      // 読む前に終わったプロセスは数えない
    }
    stack.push(...(children.get(pid) ?? []));
  }
  return total;
};

const run = async (
  tool: Tool,
  label: string,
  expected: number,
  extra: string[] = []
) => {
  const env = {
    ...process.env,
    ...tool.env,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: bunCache,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    PROOFYARD_CACHE_DIR: proofyardCache,
  };
  const logFile = nodePath.join(results, `${tool.name}-${label}.log`);
  let log = "";
  let peak = 0;
  const start = performance.now();
  for (const cmd of [...(extra.length ? [extra] : []), tool.cmd]) {
    const proc = Bun.spawn(cmd, {
      cwd: tool.cwd,
      env,
      stderr: "pipe",
      stdout: "pipe",
    });
    const timer = setInterval(
      // oxlint-disable-next-line no-loop-func -- 測っている間のピークを外の peak に入れる
      () => (peak = Math.max(peak, treePss(proc.pid))),
      50
    );
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearInterval(timer);
    // 50ms より早く終わるものは測れないので、そのプロセス自身の最大 RSS（KB）も見る
    peak = Math.max(peak, (proc.resourceUsage()?.maxRSS ?? 0) / 1024);
    log += `$ ${cmd.join(" ")}\n${out}${err}\nexit ${proc.exitCode}\n`;
    if (proc.exitCode !== 0) {
      break;
    }
  }
  const seconds = (performance.now() - start) / 1000;
  writeFileSync(logFile, log);
  const passed = tool.passed(log);
  if (passed !== expected) {
    throw new Error(
      `${tool.name} ${label}: ${expected} 件のはずが ${passed} 件（${logFile}）`
    );
  }
  console.log(
    `${tool.name} ${label}: ${seconds.toFixed(2)}s, ${(peak / 1024).toFixed(0)}MB`
  );
  return { mb: peak / 1024, seconds };
};

const median = (xs: number[]) =>
  xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)];
const generate = (n: number) =>
  Bun.spawnSync(["bun", nodePath.join(dir, "generate.ts"), String(n)], {
    stderr: "inherit",
    stdout: "inherit",
  });
const nextBuild = ["node", nodePath.join(node, "next/dist/bin/next"), "build"];

const only = process.argv.slice(2);
const selected = only.length
  ? tools.filter((t) => only.includes(t.name))
  : tools;
// ツールを選んで測ったときは、前の結果に足す
const summaryFile = nodePath.join(results, "summary.json");
const summary: Record<string, unknown> = existsSync(summaryFile)
  ? JSON.parse(readFileSync(summaryFile, "utf-8"))
  : {};
for (const tool of selected) {
  generate(1);
  tool.cold();
  // Playwright のコールドは next build を含む
  const cold = await run(
    tool,
    "cold",
    1,
    tool.name === "playwright" ? nextBuild : []
  );
  const warm = [];
  for (let i = 0; i < 3; i += 1) {
    warm.push(await run(tool, `warm${i}`, 1));
  }
  generate(100);
  const t100 = await run(tool, "100", 100);
  generate(1000);
  const t1000 = await run(tool, "1000", 1000);
  summary[tool.name] = {
    coldSeconds: cold.seconds,
    peakMB: Math.max(cold.mb, ...warm.map((w) => w.mb), t100.mb, t1000.mb),
    perTestMs: ((t1000.seconds - t100.seconds) / 900) * 1000,
    t1000Seconds: t1000.seconds,
    t100Seconds: t100.seconds,
    warmSeconds: median(warm.map((w) => w.seconds)),
  };
  writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
}
console.table(summary);
