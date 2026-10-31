"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { createUser } from "./actions";
import type { State } from "./actions";

const SubmitButton = () => {
  const { pending } = useFormStatus();
  return <button type="submit">{pending ? "Saving..." : "Create"}</button>;
};

export const UserForm = () => {
  const [state, formAction] = useActionState(createUser, {} as State);
  return (
    <form action={formAction}>
      <label>
        Name <input name="name" />
      </label>
      <SubmitButton />
      {state.message && (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- 計算結果ではなくメッセージなので <output> にしない
        <p role="status">{state.message}</p>
      )}
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
};

// Server から .bind() 済みの Server Action を props で受け取る
export const JoinButton = ({
  join,
}: {
  join: (user: string) => Promise<string>;
}) => {
  const [result, setResult] = useState("");
  return (
    <button type="button" onClick={async () => setResult(await join("Alice"))}>
      {result || "Join"}
    </button>
  );
};
