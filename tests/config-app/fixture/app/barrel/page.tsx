import { Used, fromWildcard } from "fake-barrel";

export default function BarrelPage() {
  return (
    <main>
      <h1>{fromWildcard}</h1>
      <Used />
    </main>
  );
}
