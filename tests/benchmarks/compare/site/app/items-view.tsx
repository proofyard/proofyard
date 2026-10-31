import { Counter } from "./counter";

// Server Component からも、Testing Library（Client Component として描画）からも使う
export const ItemsView = ({ items }: { items: string[] }) => (
  <main>
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
    <Counter />
  </main>
);
