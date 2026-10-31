// next/dist/client/app-call-server の代わり（ブラウザ層）。Next.js ではルーターが Server Action を呼ぶが、
// コンポーネント単位の render() にはルーターがないので、render() が用意した callServer に渡す。
// ponytail: 最後に描画した render() のものを使う。ルートの描画（Next.js のルーター）では本物を使う
// oxlint-disable-next-line require-await -- async のまま（同期の throw を reject にする）
export const callServer = async (
  id: string,
  args: unknown[]
): Promise<unknown> => {
  const current = (globalThis as unknown as Record<symbol, unknown>)[
    Symbol.for("proofyard.callServer")
  ] as ((id: string, args: unknown[]) => Promise<unknown>) | undefined;
  if (!current) {
    throw new Error(
      '[proofyard] Server Actions can only be called from a component rendered with render({ mode: "client" })'
    );
  }
  return current(id, args);
};
