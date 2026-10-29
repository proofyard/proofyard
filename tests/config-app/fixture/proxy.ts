import { after, NextResponse, type NextRequest } from "next/server";
import { tlaValue } from "./components/tla-value";

// top-level await のあるモジュールに依存する Proxy（エントリが async module になる）
// after() は Proxy の CloseController（EventTarget）で、レスポンスの後に呼ばれる
export function proxy(request: NextRequest) {
  after(() => {});
  return NextResponse.redirect(new URL(`/base/tla/?from=${encodeURIComponent(tlaValue)}`, request.url));
}
export const config = { matcher: "/tla-proxy/:path*" };
