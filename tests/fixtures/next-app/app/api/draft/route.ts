// draftMode() を有効にする（__prerender_bypass のクッキー）
import { draftMode } from "next/headers";

export const GET = async () => {
  const draft = await draftMode();
  draft.enable();
  return new Response("Draft mode enabled");
};
