// renderRoute のバンドルの react-dom/client。Next.js（app-index.tsx）が作った React のルートを記録し、テストの後片付けで外す。
// React はルートの container（Next.js では document）に付けたイベントのリスナーを unmount しても外さない。
// ブラウザならページの移動で消えるので、ここで記録して unmount のときに外す（次のテストの document に残さない）
//
// React の作業（Suspense の中のハイドレーションの続きなど）が残っているか（src/testing/render-route.ts が待つ）。
// react-dom はスケジューラーの関数を読み込み時に取り出すので、react-dom/client より先に包む。
// スケジューラーは終わった（または取り消された）タスクの callback を null にする
// （バンドラーは require した CJS を名前空間で包むので、元の module.exports（default）を包む）
const Scheduler = require("scheduler").default;
const tasks = new Set<{ callback: unknown }>();
const scheduleCallback = Scheduler.unstable_scheduleCallback;
Scheduler.unstable_scheduleCallback = (...args: unknown[]) => {
  const task = scheduleCallback(...args);
  tasks.add(task);
  return task;
};
(globalThis as any)[Symbol.for("proofyard.routeReactBusy")] = () => {
  for (const task of tasks) if (task.callback === null) tasks.delete(task);
  return tasks.size > 0;
};
// 本物の react-dom/client（App Router は Next.js 内蔵のもの、Pages Router はアプリのもの。src/next/preload.ts がバンドルごとに決める）
const ReactDOMClient: typeof import("next/dist/compiled/react-dom/client") = require("proofyard-react-dom-client");

type Root = { unmount(): void };
const roots: Set<Root> = ((globalThis as any)[Symbol.for("proofyard.routeRoots")] ??= new Set());

function track<R extends Root>(container: EventTarget, create: () => R): R {
  const listeners: Parameters<EventTarget["addEventListener"]>[] = [];
  const add = container.addEventListener;
  container.addEventListener = function (...args: Parameters<EventTarget["addEventListener"]>) {
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
        for (const [type, listener, options] of listeners) container.removeEventListener(type, listener, options);
      }
    },
  });
  return root;
}

export const createRoot: typeof ReactDOMClient.createRoot = (container, options) => track(container, () => ReactDOMClient.createRoot(container, options));
export const hydrateRoot: typeof ReactDOMClient.hydrateRoot = (container, children, options) =>
  track(container, () => ReactDOMClient.hydrateRoot(container, children, options));
export const version = ReactDOMClient.version;
export default { ...ReactDOMClient, createRoot, hydrateRoot };
