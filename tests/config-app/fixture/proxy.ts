import { after, NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { tlaValue } from "./components/tla-value";

// top-level await のあるモジュールに依存する Proxy（エントリが async module になる）
// after() は Proxy の CloseController（EventTarget）で、レスポンスの後に呼ばれる
export const proxy = (request: NextRequest) => {
  after(() => {
    // 何もしない（after() を Proxy で呼べることを確かめる）
  });
  return NextResponse.redirect(
    new URL(`/base/tla/?from=${encodeURIComponent(tlaValue)}`, request.url)
  );
};
export const config = { matcher: "/tla-proxy/:path*" };
