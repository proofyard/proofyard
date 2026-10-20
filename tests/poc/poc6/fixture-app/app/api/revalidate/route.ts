import { revalidateTag } from "next/cache";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const tag = url.searchParams.get("tag")!;
  const profile = url.searchParams.get("profile") === "max" ? "max" : { expire: 0 };
  revalidateTag(tag, profile);
  return Response.json({ revalidated: tag });
}
