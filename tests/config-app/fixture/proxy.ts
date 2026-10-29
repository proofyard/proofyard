import { NextResponse, type NextRequest } from "next/server";
import { tlaValue } from "./components/tla-value";

// top-level await のあるモジュールに依存する Proxy（エントリが async module になる）
export function proxy(request: NextRequest) {
  return NextResponse.redirect(new URL(`/base/tla/?from=${encodeURIComponent(tlaValue)}`, request.url));
}
export const config = { matcher: "/tla-proxy/:path*" };
