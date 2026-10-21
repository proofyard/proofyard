// renderRoute のバンドルの react-dom/client。Next.js（app-index.tsx）が作った React のルートを記録し、テストの後片付けで外す。
// React はルートの container（Next.js では document）に付けたイベントのリスナーを unmount しても外さない。
// ブラウザならページの移動で消えるので、ここで記録して unmount のときに外す（次のテストの document に残さない）
import ReactDOMClient from "next/dist/compiled/react-dom/client";

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
