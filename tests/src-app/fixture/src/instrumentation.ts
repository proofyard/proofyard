// next start と同じく、Next.js 本体が起動時に register、描画のエラーで onRequestError を呼ぶ
const g = globalThis as {
  registered?: number;
  requestErrors?: { message: string; path: string; routePath: string }[];
};

// oxlint-disable-next-line eslint/require-await -- Next.js の instrumentation の hook と同じく async にする
export const register = async () => {
  g.registered = (g.registered ?? 0) + 1;
};

// oxlint-disable-next-line eslint/require-await -- Next.js の instrumentation の hook と同じく async にする
export const onRequestError = async (
  error: Error,
  request: { path: string },
  context: { routePath: string }
) => {
  (g.requestErrors ??= []).push({
    message: error.message,
    path: request.path,
    routePath: context.routePath,
  });
};
