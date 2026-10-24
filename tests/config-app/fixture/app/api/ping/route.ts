export function GET(request: Request) {
  return Response.json({ path: new URL(request.url).pathname });
}
