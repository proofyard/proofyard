// ブラウザで、アプリより先に動く（Next.js の instrumentation-client）
const w = window as unknown as { clientInstrumented?: boolean; transitions?: [string, string][] };
w.clientInstrumented = true;
w.transitions = [];

export function onRouterTransitionStart(url: string, type: string) {
  w.transitions!.push([url, type]);
}
