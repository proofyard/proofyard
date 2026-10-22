import { todos } from "../../../components/todos";

export function GET() {
  todos.apiGets += 1;
  return Response.json(todos.items);
}

export async function POST(request: Request) {
  todos.items.push(await request.text());
  return Response.json(todos.items);
}
