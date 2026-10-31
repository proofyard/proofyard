import { todos } from "../../../components/todos";

export const GET = () => {
  todos.apiGets += 1;
  return Response.json(todos.items);
};

export const POST = async (request: Request) => {
  todos.items.push(await request.text());
  return Response.json(todos.items);
};
