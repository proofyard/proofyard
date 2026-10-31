import { tlaValue } from "../../components/tla-value";

// top-level await のあるモジュールに依存する Server Component（ページのエントリが async module になる）
const TlaServerPage = () => <h1>Server: {tlaValue}</h1>;
export default TlaServerPage;
