// 実行をまたいだビルドの結果のキャッシュ（層のビルド、node_modules を辿った結果）。
// 単位ごとに、鍵（設定やバージョンなど）と、作るときに読んだファイル（入力）の mtime と大きさを保存し、次の実行で鍵が同じで入力が
// 変わっていなければ、結果（と出力のディレクトリ）をそのまま使う。プロセスごとの作業ディレクトリのファイルは毎回書き直すので中身で比べる
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function unitCache(root: string, work: string) {
  // 作業ディレクトリ（プロセスごとに違う）のパスは置き換えて比べ、保存する。パスの途中のもの（出力のファイル名 out/tmp/proofyard-next-1/... は
  // 入口のパスを含む）はそのまま
  const WORK = "$PROOFYARD_WORK";
  const workPath = new RegExp(`(?<![\\w.-])${work.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
  const portable = (text: string) => text.replace(workPath, WORK);
  const fingerprint = (path: string): string | null => {
    try {
      if (path.startsWith(work + "/")) return Bun.hash(portable(readFileSync(path, "utf8"))).toString(36);
      const stat = statSync(path);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return null;
    }
  };
  const ids = (base: string) => (existsSync(base) ? readdirSync(base).sort().reverse() : []);
  return {
    portable,
    // 鍵が同じで入力が変わっていない結果（新しいものから）。miss には使えなかった理由（新しいもの）を渡す
    lookup<T>(key: string, miss?: (reason: string) => void): T | undefined {
      const base = join(root, key);
      let reason = "no entry for this key";
      for (const id of ids(base)) {
        try {
          const inputs: [string, string][] = JSON.parse(readFileSync(join(base, id, "inputs.json"), "utf8"));
          const changed = inputs.find(([path, print]) => fingerprint(path.split(WORK).join(work)) !== print);
          if (changed) {
            if (reason === "no entry for this key") reason = `changed: ${changed[0]} (${changed[1]} -> ${fingerprint(changed[0].split(WORK).join(work))})`;
            continue;
          }
          const value = JSON.parse(readFileSync(join(base, id, "value.json"), "utf8").split(WORK).join(work));
          const now = new Date();
          utimesSync(base, now, now); // 使っている鍵は消さない（下）
          return value;
        } catch {
          // 作りかけや壊れたもの
        }
      }
      miss?.(reason);
      return undefined;
    },
    // 作る単位の置き場所（dir に出力を書く）。作り終えたら commit で結果を書く（それまで lookup は使わない）
    begin(key: string) {
      const base = join(root, key);
      const dir = join(base, `${Date.now()}-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      // ponytail: 鍵ごとに新しい 3 つと、7 日以内に使った鍵だけ残す。同じアプリを同時に動かすと、別の実行が使っている古いものを消しうる
      for (const old of ids(base).slice(3)) rmSync(join(base, old), { recursive: true, force: true });
      for (const other of readdirSync(root))
        if (statSync(join(root, other)).mtimeMs < Date.now() - 7 * 86400_000) rmSync(join(root, other), { recursive: true, force: true });
      return {
        dir,
        // 作り始める前（startedAt）より後に変わった入力があれば、作ったものが古いかもしれないので保存しない（そのファイルを返す）
        commit(inputs: Iterable<string>, value: unknown, startedAt: number): string | undefined {
          const prints: [string, string][] = [];
          for (const path of inputs) {
            const print = fingerprint(path);
            if (print === null) continue; // 無いファイル（生成して消えたものなど）
            if (!path.startsWith(work + "/") && Number(print.split(":")[0]) > startedAt) return path;
            prints.push([portable(path), print]);
          }
          writeFileSync(join(dir, "inputs.json"), JSON.stringify(prints));
          writeFileSync(join(dir, "value.tmp"), portable(JSON.stringify(value)));
          renameSync(join(dir, "value.tmp"), join(dir, "value.json"));
        },
      };
    },
  };
}
