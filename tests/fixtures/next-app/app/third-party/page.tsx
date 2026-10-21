import { Counter, Tip, formatLabel } from "fake-ui";

export default function Page() {
  return (
    <main>
      <Counter label={formatLabel("clicks")} />
      <Tip>tip</Tip>
    </main>
  );
}
