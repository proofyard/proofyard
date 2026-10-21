// next start と同じく、Next.js 本体が起動時に register、描画のエラーで onRequestError を呼ぶ
const g = globalThis as { registered?: number; requestErrors?: { message: string; path: string; routePath: string }[] };

export async function register() {
  g.registered = (g.registered ?? 0) + 1;
}

export async function onRequestError(error: Error, request: { path: string }, context: { routePath: string }) {
  (g.requestErrors ??= []).push({ message: error.message, path: request.path, routePath: context.routePath });
}
