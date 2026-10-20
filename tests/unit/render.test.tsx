import { expect, test } from "bun:test";
import { render } from "proofyard";
import { Counter } from "../fixtures/next-app/components/counter";

async function Page() {
  const name = await Promise.resolve("Alice");
  return (
    <main>
      <h1>Hello {name}</h1>
      <Counter label="Clicks" initial={2} />
    </main>
  );
}

test("SSR Mode: Server と Client Components の初期 HTML（Effect は動かない）", async () => {
  const result = await render(<Page />, { mode: "ssr" });
  expect(result.getByRole("heading").textContent).toBe("Hello Alice");
  expect(result.getByRole("button").textContent).toBe("Clicks: 2");
  expect(result.getByText("Not ready")).toBeDefined();
  expect(result.html).toContain("<h1>Hello <!-- -->Alice</h1>");
});

test("Client Mode: Effect が動き、クリックで状態が更新される", async () => {
  const result = await render(<Page />);
  await result.findByText("Ready");
  await result.user!.click(result.getByRole("button"));
  expect(result.getByRole("button").textContent).toBe("Clicks: 3");
});

test("Hydration: SSR の HTML を hydrateRoot し、操作できる", async () => {
  const result = await render(<Page />, { mode: "client", hydrate: true });
  expect(result.html).toContain("Not ready");
  await result.findByText("Ready");
  await result.user!.click(result.getByRole("button"));
  expect(result.getByRole("button").textContent).toBe("Clicks: 3");
  expect(result.recoverableErrors).toEqual([]);
});

test("Hydration Mismatch は recoverableErrors に届く（SSR の typeof window は Next.js と同じく undefined）", async () => {
  const { EnvironmentLabel } = await import("../fixtures/next-app/components/environment-label");
  const result = await render(<EnvironmentLabel />, { mode: "client", hydrate: true });
  expect(result.html).toBe("<p>rendered on <!-- -->server</p>");
  await result.findByText("rendered on client");
  expect(result.recoverableErrors.length).toBeGreaterThan(0);
  expect(String(result.recoverableErrors[0])).toContain("Hydration failed");
});

test("Server → Client（Provider）→ Server → Client（Context を読む）の入れ子", async () => {
  const { ThemeProvider, ThemeToggle } = await import("../fixtures/next-app/components/theme");
  async function Settings() {
    const title = await Promise.resolve("Settings");
    return (
      <section>
        <h2>{title}</h2>
        <ThemeToggle />
      </section>
    );
  }
  const page = (
    <ThemeProvider initial="dark">
      <Settings />
    </ThemeProvider>
  );
  const ssr = await render(page, { mode: "ssr" });
  expect(ssr.getByRole("button").textContent).toBe("theme: dark");

  const client = await render(page);
  expect(client.getByRole("heading").textContent).toBe("Settings");
  await client.user!.click(client.getByRole("button"));
  expect(client.getByRole("button").textContent).toBe("theme: light");
});
