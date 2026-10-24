// draftMode() を有効にする（__prerender_bypass のクッキー）
import { draftMode } from "next/headers";

export async function GET() {
  (await draftMode()).enable();
  return new Response("Draft mode enabled");
}
