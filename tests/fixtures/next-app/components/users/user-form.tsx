"use client";
import { useActionState, useOptimistic, useState, startTransition } from "react";
import { useFormStatus } from "react-dom";
import { createUser, type State } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Saving..." : "Create"}</button>;
}

export function UserForm() {
  const [state, formAction] = useActionState(createUser, {} as State);
  return (
    <form action={formAction}>
      <label>
        Name <input name="name" />
      </label>
      <SubmitButton />
      {state.message && <p role="status">{state.message}</p>}
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}

// Server から .bind() 済みの Server Action を props で受け取る
export function JoinButton({ join }: { join: (user: string) => Promise<string> }) {
  const [result, setResult] = useState("");
  return <button onClick={async () => setResult(await join("Alice"))}>{result || "Join"}</button>;
}

// 任意の Server Action を呼び、結果かエラーを表示する
export function CallButton({ label, action }: { label: string; action: () => Promise<unknown> }) {
  const [result, setResult] = useState("");
  return (
    <button
      onClick={() =>
        action().then(
          (value) => setResult(`ok: ${typeof value}`),
          (error: Error) => setResult(`error: ${error.message}`),
        )
      }
    >
      {result || label}
    </button>
  );
}

// useOptimistic: Action の完了前に楽観的な表示をする
export function LikeCounter({ likes, like }: { likes: number; like: () => Promise<number> }) {
  const [count, setCount] = useState(likes);
  const [optimistic, addOptimistic] = useOptimistic(count, (current, delta: number) => current + delta);
  return (
    <button
      onClick={() =>
        startTransition(async () => {
          addOptimistic(1);
          setCount(await like());
        })
      }
    >
      likes: {optimistic}
    </button>
  );
}
