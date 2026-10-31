// 実行をまたいだビルドの結果のキャッシュ（層のビルド、node_modules を辿った結果）。
// 単位ごとに、鍵（設定やバージョンなど）と、作るときに読んだファイル（入力）の指紋を保存し、次の実行で鍵が同じで入力が
// 変わっていなければ、結果（と出力のディレクトリ）をそのまま使う。指紋は、node_modules（数千のファイル）は mtime と大きさ、
// それ以外（アプリのファイルと、プロセスごとの作業ディレクトリに毎回書き直すファイル）は中身（touch や git のブランチの行き来で外れないように）
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";

const { join } = nodePath;

const ids = (base: string) =>
  existsSync(base) ? readdirSync(base).toSorted().toReversed() : [];

export const unitCache = (root: string, work: string) => {
  // 作業ディレクトリ（プロセスごとに違う）のパスは置き換えて比べ、保存する。パスの途中のもの（出力のファイル名 out/tmp/proofyard-next-1/... は
  // 入口のパスを含む）はそのまま
  const WORK = "$PROOFYARD_WORK";
  const workPath = new RegExp(
    `(?<![\\w.-])${work.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`,
    "gu"
  );
  const portable = (text: string) => text.replaceAll(workPath, WORK);
  const fingerprint = (path: string): string | null => {
    try {
      if (path.startsWith(`${work}/`)) {
        return Bun.hash(portable(readFileSync(path, "utf-8"))).toString(36);
      }
      if (!path.includes("/node_modules/")) {
        return Bun.hash(readFileSync(path)).toString(36);
      }
      const stat = statSync(path);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return null;
    }
  };
  return {
    // 作る単位の置き場所（dir に出力を書く）。作り終えたら commit で結果を書く（それまで lookup は使わない）
    begin(key: string) {
      const base = join(root, key);
      const dir = join(base, `${Date.now()}-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      // ponytail: 鍵ごとに新しい 3 つと、7 日以内に使った鍵だけ残す。同じアプリを同時に動かすと、別の実行が使っている古いものを消しうる
      for (const old of ids(base).slice(3)) {
        rmSync(join(base, old), { force: true, recursive: true });
      }
      for (const other of readdirSync(root)) {
        if (statSync(join(root, other)).mtimeMs < Date.now() - 7 * 86_400_000) {
          rmSync(join(root, other), { force: true, recursive: true });
        }
      }
      return {
        // 作り始める前（startedAt）より後に変わった入力があれば、作ったものが古いかもしれないので保存しない（そのファイルを返す）
        commit(
          inputs: Iterable<string>,
          value: unknown,
          startedAt: number
        ): string | undefined {
          const prints: [string, string][] = [];
          for (const path of inputs) {
            const print = fingerprint(path);
            // 無いファイル（生成して消えたものなど）
            if (print === null) {
              continue;
            }
            if (
              !path.startsWith(`${work}/`) &&
              statSync(path).mtimeMs > startedAt
            ) {
              return path;
            }
            prints.push([portable(path), print]);
          }
          writeFileSync(join(dir, "inputs.json"), JSON.stringify(prints));
          writeFileSync(
            join(dir, "value.tmp"),
            portable(JSON.stringify(value))
          );
          renameSync(join(dir, "value.tmp"), join(dir, "value.json"));
        },
        dir,
      };
    },
    // 鍵が同じで入力が変わっていない結果（新しいものから）。miss には使えなかった理由（新しいもの）を渡す
    lookup<T>(key: string, miss?: (reason: string) => void): T | undefined {
      const base = join(root, key);
      let reason = "no entry for this key";
      for (const id of ids(base)) {
        try {
          const inputs: [string, string][] = JSON.parse(
            readFileSync(join(base, id, "inputs.json"), "utf-8")
          );
          const changed = inputs.find(
            ([path, print]) =>
              fingerprint(path.split(WORK).join(work)) !== print
          );
          if (changed) {
            if (reason === "no entry for this key") {
              reason = `changed: ${changed[0]} (${changed[1]} -> ${fingerprint(changed[0].split(WORK).join(work))})`;
            }
            continue;
          }
          const value = JSON.parse(
            readFileSync(join(base, id, "value.json"), "utf-8")
              .split(WORK)
              .join(work)
          );
          const now = new Date();
          // 使っている鍵は消さない（下）
          utimesSync(base, now, now);
          return value;
        } catch {
          // 作りかけや壊れたもの
        }
      }
      miss?.(reason);
      return undefined;
    },
    portable,
  };
};
