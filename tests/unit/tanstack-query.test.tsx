// TanStack Query（仕様 16.3）: Server Component の prefetch → dehydrate → HydrationBoundary → クライアントの useQuery
import { expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";
import { todos } from "../fixtures/next-app/components/todos";

test("Server Component で prefetch したデータを SSR し、クライアントは取り直さない", async () => {
  todos.items = ["Write tests"];
  todos.serverFetches = 0;
  todos.apiGets = 0;
  expect(await (await requestRoute("/query")).text()).toContain('<ul aria-label="todos"><li>Write tests</li></ul>');
  const app = await renderRoute("/query");
  expect(app.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Write tests"]);
  expect(todos.serverFetches).toBe(2);
  expect(todos.apiGets).toBe(0);
  expect(app.errors).toEqual([]);
});

test("useMutation と invalidateQueries でブラウザから Route Handler を呼び、取り直す", async () => {
  todos.items = ["Write tests"];
  todos.apiGets = 0;
  const app = await renderRoute("/query");
  await app.user.click(app.getByRole("button", { name: "Add todo" }));
  await app.findByText("Ship it");
  expect(todos.items).toEqual(["Write tests", "Ship it"]);
  expect(todos.apiGets).toBe(1);
  expect(app.errors).toEqual([]);
});
