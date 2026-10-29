import { tlaValue } from "../../components/tla-value";

// top-level await のあるモジュールに依存する Server Component（ページのエントリが async module になる）
export default function TlaServerPage() {
  return <h1>Server: {tlaValue}</h1>;
}
