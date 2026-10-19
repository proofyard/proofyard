// Server Graph の入口。テストからは `import(".../server.ts?rsc")` で読む
import { createElement } from "react";
import { renderToReadableStream } from "react-server-dom-turbopack/server";

export async function renderFlight(entry: string, clientManifest: object) {
  const errors: unknown[] = [];
  const { default: Component } = await import(entry);
  const stream = renderToReadableStream(createElement(Component), clientManifest, {
    onError: (e: unknown) => void errors.push(e),
  });
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), errors };
}

export { createElement };
