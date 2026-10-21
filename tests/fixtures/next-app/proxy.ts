import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const session = request.cookies.get("session")?.value;
  if (request.nextUrl.pathname.startsWith("/admin")) {
    if (!session) return NextResponse.redirect(new URL("/users", request.url));
    return NextResponse.rewrite(new URL(`/users/${session}`, request.url));
  }
  // API: ログイン中のユーザーをリクエストヘッダーで渡し、応答に Cookie を付ける
  const headers = new Headers(request.headers);
  headers.set("x-user", session ?? "guest");
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set("seen", "1");
  return response;
}

export const config = { matcher: ["/admin/:path*", "/api/:path*"] };
