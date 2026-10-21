import { CallButton } from "./user-form";

// 関数の中の "use server"（クロージャ）。team は Next.js が暗号化してクライアントに渡す
export function Greeting({ team }: { team: string }) {
  async function greet() {
    "use server";
    return `hello from ${team}`;
  }
  return <CallButton label="greet" action={greet} />;
}
