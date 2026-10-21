// next/dist/client/app-call-server の代わり（ブラウザ層）。Next.js ではルーターが Server Action を呼ぶが、
// コンポーネント単位の render() にはルーターがないので、render() が用意した callServer に渡す。
// ponytail: 最後に描画した render() のものを使う。ルートの描画（Next.js のルーター）では本物を使う
export async function callServer(id: string, args: unknown[]): Promise<unknown> {
  const callServer = (globalThis as any)[Symbol.for("proofyard.callServer")];
  if (!callServer) throw new Error("[proofyard] Server Actions can only be called from a component rendered with render({ mode: \"client\" })");
  return callServer(id, args);
}
