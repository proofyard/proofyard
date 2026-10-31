import { revalidateTag } from "next/cache";

// oxlint-disable-next-line require-await -- Route Handler の例外を reject として返す（元の async function と同じ）
export const POST = async (request: Request) => {
  const url = new URL(request.url);
  // oxlint-disable-next-line typescript/no-non-null-assertion -- テストは必ず tag を付ける
  const tag = url.searchParams.get("tag")!;
  const profile =
    url.searchParams.get("profile") === "max" ? "max" : { expire: 0 };
  revalidateTag(tag, profile);
  return Response.json({ revalidated: tag });
};
