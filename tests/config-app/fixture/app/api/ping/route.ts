export const GET = (request: Request) =>
  Response.json({ path: new URL(request.url).pathname });
