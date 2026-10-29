import { Used, fromWildcard } from "fake-barrel";
import { BarrelClient } from "../../components/barrel-client";

export default function BarrelPage() {
  return (
    <main>
      <h1>{fromWildcard}</h1>
      <Used />
      <BarrelClient />
    </main>
  );
}
