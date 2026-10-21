import { cookies, headers } from "next/headers";

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return Response.json({ name, user: (await headers()).get("x-user"), theme: (await cookies()).get("theme")?.value ?? null });
}

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { message } = await request.json();
  return Response.json({ to: (await params).name, message }, { status: 201 });
}
