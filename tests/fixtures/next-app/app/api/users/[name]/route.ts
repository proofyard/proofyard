import { cookies, headers } from "next/headers";

export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) => {
  const { name } = await params;
  const cookieStore = await cookies();
  const headerStore = await headers();
  return Response.json({
    name,
    theme: cookieStore.get("theme")?.value ?? null,
    user: headerStore.get("x-user"),
  });
};

export const POST = async (
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) => {
  const { message } = await request.json();
  const { name } = await params;
  return Response.json({ message, to: name }, { status: 201 });
};
