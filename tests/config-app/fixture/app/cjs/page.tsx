import { fromCjs } from "fake-cjs";

export default function CjsPage() {
  return <h1>{fromCjs}</h1>;
}
