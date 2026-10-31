import { NextResponse } from "next/server";

export const proxy = () => {
  const response = NextResponse.next();
  response.headers.set("x-src-proxy", "1");
  return response;
};
