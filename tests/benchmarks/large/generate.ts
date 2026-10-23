// Phase 8 / 仕様 20.5: 大規模なアプリ（EC くらい）のベンチマーク用のアプリとテストを作る。
//   bun tests/benchmarks/large/generate.ts → tests/benchmarks/large/app と tests/benchmarks/large/tests（git には入れない）
// 規模: 20 セクション × 5 ページ = 100 ルート、Client Component 300、Server Component 1,000、テスト 1,000 件
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SECTIONS = 20;
const CLIENT_PER_SECTION = 15;
const SERVER_PER_SECTION = 50;
const TESTS_PER_SECTION = 50;

const root = import.meta.dir;
const app = join(root, "app");
const tests = join(root, "tests");
for (const dir of [app, tests]) rmSync(dir, { recursive: true, force: true });
const write = (path: string, code: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, code);
};

write(join(app, "next.config.ts"), `import type { NextConfig } from "next";\nconst config: NextConfig = {};\nexport default config;\n`);
write(
  join(app, "app/layout.tsx"),
  `import Link from "next/link";
import { CartBadge } from "../components/cart-badge";

export const metadata = { title: { template: "%s | Shop", default: "Shop" } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/">Shop</Link>
          <CartBadge />
        </header>
        {children}
      </body>
    </html>
  );
}
`,
);
write(
  join(app, "app/page.tsx"),
  `import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Shop</h1>
      <ul>
${Array.from({ length: SECTIONS }, (_, s) => `        <li><Link href="/s${s}">Section ${s}</Link></li>`).join("\n")}
      </ul>
    </main>
  );
}
`,
);
write(
  join(app, "components/cart-badge.tsx"),
  `"use client";
import { useState } from "react";

export function CartBadge() {
  const [open, setOpen] = useState(false);
  return <button type="button" onClick={() => setOpen((o) => !o)}>{open ? "Close cart" : "Cart"}</button>;
}
`,
);

// Client Component の型（どれも state を持ち、クリックで表示が変わる）
const clientTemplates = [
  (name: string) => `"use client";
import { useState } from "react";

export function ${name}({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return <button type="button" onClick={() => setCount((c) => c + 1)}>{label} ${name}: {count}</button>;
}
`,
  (name: string) => `"use client";
import { useState } from "react";

export function ${name}({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)}>{label} ${name} toggle</button>
      {open && <p>{label} ${name} details</p>}
    </div>
  );
}
`,
  (name: string) => `"use client";
import { useState } from "react";

export function ${name}({ label }: { label: string }) {
  const tabs = ["Spec", "Reviews", "Shipping"];
  const [tab, setTab] = useState(tabs[0]);
  return (
    <div>
      {tabs.map((t) => <button type="button" key={t} onClick={() => setTab(t)}>{label} ${name} {t}</button>)}
      <p>{label} ${name} tab: {tab}</p>
    </div>
  );
}
`,
  (name: string) => `"use client";
import { useMemo, useState } from "react";

export function ${name}({ label }: { label: string }) {
  const [query, setQuery] = useState("");
  const items = useMemo(() => ["red", "green", "blue"].filter((c) => c.includes(query)), [query]);
  return (
    <div>
      <input aria-label={\`\${label} ${name} filter\`} value={query} onChange={(e) => setQuery(e.target.value)} />
      <p>{label} ${name} shown: {items.length}</p>
    </div>
  );
}
`,
  (name: string) => `"use client";
import { usePathname } from "next/navigation";

export function ${name}({ label }: { label: string }) {
  return <p>{label} ${name} at {usePathname()}</p>;
}
`,
];

const testFiles: string[] = [];
for (let s = 0; s < SECTIONS; s++) {
  const sec = join(app, `app/s${s}`);
  const comp = join(app, `components/s${s}`);
  const clients = Array.from({ length: CLIENT_PER_SECTION }, (_, i) => `S${s}Client${i}`);
  clients.forEach((name, i) => write(join(comp, `client-${i}.tsx`), clientTemplates[i % clientTemplates.length]!(name)));
  const servers = Array.from({ length: SERVER_PER_SECTION }, (_, i) => `S${s}Part${i}`);
  servers.forEach((name, i) =>
    write(
      join(comp, `part-${i}.tsx`),
      // 一部は async（データを待つ Server Component）
      i % 5 === 0
        ? `import { getItems } from "./db";\n\nexport async function ${name}() {\n  const items = await getItems();\n  return <section><h2>${name}</h2><p>${name} items: {items.length}</p></section>;\n}\n`
        : `export function ${name}({ note }: { note?: string }) {\n  return <section><h2>${name}</h2><p>{note ?? "${name} text"}</p></section>;\n}\n`,
    ),
  );
  write(
    join(comp, "db.ts"),
    `export const db = { items: ["Item A", "Item B"] };\nexport async function getItems() {\n  await new Promise((r) => setTimeout(r, 1));\n  return db.items;\n}\n`,
  );
  write(
    join(comp, "actions.ts"),
    `"use server";
import { revalidatePath } from "next/cache";
import { db } from "./db";

export async function addItem(formData: FormData) {
  db.items.push(String(formData.get("name")));
  revalidatePath("/s${s}");
}
`,
  );
  // ページごとに使う部品（Server Component 10 個、Client Component 3 個）
  const pick = <T,>(xs: T[], page: number, n: number) => Array.from({ length: n }, (_, i) => xs[(page * n + i) % xs.length]!);
  const page = (pageIndex: number, title: string, body: string, extra = "") => {
    const parts = pick(servers, pageIndex, 10);
    const used = pick(clients, pageIndex, 3);
    return `${parts.map((n) => `import { ${n} } from "${"../".repeat(title === "Section" ? 2 : 3)}components/s${s}/part-${servers.indexOf(n)}";`).join("\n")}
${used.map((n) => `import { ${n} } from "${"../".repeat(title === "Section" ? 2 : 3)}components/s${s}/client-${clients.indexOf(n)}";`).join("\n")}
${extra}
export default async function Page(${title === "Item" ? "{ params }: { params: Promise<{ id: string }> }" : ""}) {
  return (
    <main>
      <h1>${title === "Item" ? `{\`Item ${s} \${(await params).id}\`}` : `${title} ${s}`}</h1>
${body}
${parts.map((n) => `      <${n} />`).join("\n")}
${used.map((n) => `      <${n} label="p${pageIndex}" />`).join("\n")}
    </main>
  );
}
`;
  };
  write(
    join(sec, "layout.tsx"),
    `import Link from "next/link";\n\nexport default function Layout({ children }: { children: React.ReactNode }) {\n  return (\n    <div>\n      <nav>\n        <Link href="/s${s}">List ${s}</Link>\n        <Link href="/s${s}/1">First ${s}</Link>\n        <Link href="/s${s}/about">About ${s}</Link>\n      </nav>\n      {children}\n    </div>\n  );\n}\n`,
  );
  write(
    join(sec, "page.tsx"),
    page(
      0,
      "Section",
      `      <ul aria-label="items">{db.items.map((i) => <li key={i}>{i}</li>)}</ul>
      <form action={addItem}>
        <input name="name" aria-label="new item" />
        <button>Add</button>
      </form>`,
      `import { db } from "../../components/s${s}/db";\nimport { addItem } from "../../components/s${s}/actions";`,
    ),
  );
  write(join(sec, "[id]/page.tsx"), page(1, "Item", ""));
  write(join(sec, "edit/page.tsx"), page(2, "Edit", ""));
  write(
    join(sec, "reviews/page.tsx"),
    page(3, "Reviews", `      <Suspense fallback={<p>Loading reviews</p>}>\n        <Slow />\n      </Suspense>`, `import { Suspense } from "react";\nimport { S${s}Part0 as Slow } from "../../../components/s${s}/part-0";`),
  );
  write(join(sec, "about/page.tsx"), page(4, "About", ""));

  // テスト（requestRoute 20%・SSR 20%・Client の表示 30%・クリック 20%・Server Action 10%）
  const kinds: string[] = [];
  for (let i = 0; i < TESTS_PER_SECTION; i++) {
    const r = i % 10;
    const kind = r < 2 ? "request" : r < 4 ? "ssr" : r < 7 ? "client" : r < 9 ? "click" : "action";
    const path = [`/s${s}`, `/s${s}/${i}`, `/s${s}/edit`, `/s${s}/reviews`, `/s${s}/about`][i % 5]!;
    const heading = [`Section ${s}`, `Item ${s} ${i}`, `Edit ${s}`, `Reviews ${s}`, `About ${s}`][i % 5]!;
    const pageIndex = i % 5;
    const client = pick(clients, pageIndex, 3)[0]!;
    const body = {
      request: `  const res = await requestRoute("${path}");\n  expect(res.status).toBe(200);\n  expect(await res.text()).toContain("${heading}");`,
      ssr: `  const app = await renderRoute("${path}", { mode: "ssr" });\n  expect(app.getByRole("heading", { level: 1, name: "${heading}" })).toBeTruthy();`,
      client: `  const app = await renderRoute("${path}");\n  expect(app.getByRole("heading", { level: 1, name: "${heading}" })).toBeTruthy();`,
      click:
        clients.indexOf(client) % clientTemplates.length === 0
          ? `  const app = await renderRoute("${path}");\n  await app.user.click(app.getByRole("button", { name: "p${pageIndex} ${client}: 0" }));\n  await app.findByRole("button", { name: "p${pageIndex} ${client}: 1" });`
          : `  const app = await renderRoute("${path}");\n  await app.user.click(app.getByRole("button", { name: "Cart" }));\n  await app.findByRole("button", { name: "Close cart" });`,
      action: `  const app = await renderRoute("/s${s}");\n  await app.user.type(app.getByRole("textbox", { name: "new item" }), "Item ${i}");\n  await app.user.click(app.getByRole("button", { name: "Add" }));\n  await app.findByText("Item ${i}");`,
    }[kind];
    kinds.push(`test("${kind} ${path} #${i}", async () => {\n${body}\n});\n`);
  }
  const file = join(tests, `s${s}.test.tsx`);
  write(
    file,
    `import { beforeEach, expect, test } from "bun:test";
import { renderRoute, requestRoute } from "proofyard";
import { db } from "../app/components/s${s}/db";

beforeEach(() => {
  db.items = ["Item A", "Item B"];
});

${kinds.join("\n")}`,
  );
  testFiles.push(file);
}
console.log(`generated ${SECTIONS * 5 + 1} routes, ${SECTIONS * CLIENT_PER_SECTION + 1} client components, ${SECTIONS * SERVER_PER_SECTION} server components, ${SECTIONS * TESTS_PER_SECTION} tests`);
