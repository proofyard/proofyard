import { Counter, Tip, formatLabel } from "fake-ui";

const Page = () => (
  <main>
    <Counter label={formatLabel("clicks")} />
    <Tip>tip</Tip>
  </main>
);
export default Page;
