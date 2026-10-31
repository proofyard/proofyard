"use client";
import {
  useActionState,
  useOptimistic,
  useState,
  startTransition,
} from "react";
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
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <output> にすると描画する markup が変わる */}
      {state.message && <p role="status">{state.message}</p>}
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

// 任意の Server Action を呼び、結果かエラーを表示する
export const CallButton = ({
  label,
  action,
}: {
  label: string;
  action: () => Promise<unknown>;
}) => {
  const [result, setResult] = useState("");
  return (
    <button
      type="button"
      onClick={() =>
        action().then(
          (value) => setResult(`ok: ${typeof value}`),
          // oxlint-disable-next-line promise/prefer-await-to-callbacks -- 成功時の処理の例外は拾わない .then(onFulfilled, onRejected) のまま
          (error: Error) => setResult(`error: ${error.message}`)
        )
      }
    >
      {result || label}
    </button>
  );
};

// useOptimistic: Action の完了前に楽観的な表示をする
export const LikeCounter = ({
  likes,
  like,
}: {
  likes: number;
  like: () => Promise<number>;
}) => {
  const [count, setCount] = useState(likes);
  const [optimistic, addOptimistic] = useOptimistic(
    count,
    (current, delta: number) => current + delta
  );
  return (
    <button
      type="button"
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
};
