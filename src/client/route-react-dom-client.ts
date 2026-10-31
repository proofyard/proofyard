// renderRoute のバンドルの react-dom/client。Next.js（app-index.tsx）が作った React のルートを記録し、テストの後片付けで外す。
// React はルートの container（Next.js では document）に付けたイベントのリスナーを unmount しても外さない。
// ブラウザならページの移動で消えるので、ここで記録して unmount のときに外す（次のテストの document に残さない）
//
// React の作業（Suspense の中のハイドレーションの続きなど）が残っているか（src/testing/render-route.ts が待つ）。
// react-dom はスケジューラーの関数を読み込み時に取り出すので、react-dom/client より先に包む。
// スケジューラーは終わった（または取り消された）タスクの callback を null にする
// （バンドラーは require した CJS を名前空間で包むので、元の module.exports（default）を包む）
import type * as ReactDOMClientModule from "next/dist/compiled/react-dom/client";

// oxlint-disable-next-line unicorn/prefer-module -- react-dom/client を読む前に同期で包む必要がある（scheduler は実行時に解決する）
const Scheduler = require("scheduler").default;

const store = globalThis as unknown as Record<symbol, unknown>;

const tasks = new Set<{ callback: unknown }>();
const scheduleCallback = Scheduler.unstable_scheduleCallback;
Scheduler.unstable_scheduleCallback = (...args: unknown[]) => {
  const task = scheduleCallback(...args);
  tasks.add(task);
  return task;
};
store[Symbol.for("proofyard.routeReactBusy")] = () => {
  for (const task of tasks) {
    if (task.callback === null) {
      tasks.delete(task);
    }
  }
  return tasks.size > 0;
};
// oxlint-disable-next-line unicorn/prefer-module -- scheduler を包んだ後に読む（import だと先に評価される）
const ReactDOMClient: typeof ReactDOMClientModule = require("next/dist/compiled/react-dom/client");

interface Root {
  unmount: () => void;
}
const rootsKey = Symbol.for("proofyard.routeRoots");
store[rootsKey] ??= new Set<Root>();
const roots = store[rootsKey] as Set<Root>;

const track = <R extends Root>(container: EventTarget, create: () => R): R => {
  const listeners: Parameters<EventTarget["addEventListener"]>[] = [];
  const add = container.addEventListener;
  container.addEventListener = function addEventListener(
    ...args: Parameters<EventTarget["addEventListener"]>
  ) {
    listeners.push(args);
    return add.apply(this, args);
  };
  let root: R;
  try {
    root = create();
  } finally {
    delete (container as { addEventListener?: unknown }).addEventListener;
  }
  roots.add({
    unmount() {
      try {
        root.unmount();
      } finally {
        for (const [type, listener, options] of listeners) {
          container.removeEventListener(type, listener, options);
        }
      }
    },
  });
  return root;
};

export const createRoot: typeof ReactDOMClient.createRoot = (
  container,
  options
) => track(container, () => ReactDOMClient.createRoot(container, options));
export const hydrateRoot: typeof ReactDOMClient.hydrateRoot = (
  container,
  children,
  options
) =>
  track(container, () =>
    ReactDOMClient.hydrateRoot(container, children, options)
  );
export const { version } = ReactDOMClient;
export default { ...ReactDOMClient, createRoot, hydrateRoot };
