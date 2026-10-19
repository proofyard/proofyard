"use client";
import { useActionState, useState } from "react";
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
