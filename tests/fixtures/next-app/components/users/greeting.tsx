import { CallButton } from "./user-form";

// 関数の中の "use server"（クロージャ）。team は Next.js が暗号化してクライアントに渡す
export const Greeting = ({ team }: { team: string }) => {
  // oxlint-disable-next-line eslint/func-style, eslint/require-await -- "use cache" / "use server" の関数はアロー関数にせず関数宣言のまま、async で残す
  async function greet() {
    "use server";
    return `hello from ${team}`;
  }
  return <CallButton label="greet" action={greet} />;
};
