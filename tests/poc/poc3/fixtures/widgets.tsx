"use client";
import { use, useEffect, useLayoutEffect, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";

export const effects: string[] = [];

export const Counter = ({ label }: { label: string }) => {
  const [count, setCount] = useState(0);
  useLayoutEffect(() => {
    effects.push(`layout:${count}`);
  }, [count]);
  useEffect(() => {
    effects.push(`effect:${count}`);
    return () => {
      effects.push(`cleanup:${count}`);
    };
  }, [count]);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      {label}: {count}
    </button>
  );
};

export const Greeting = () => {
  const [name, setName] = useState("");
  const [greeted, setGreeted] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setGreeted(name);
  };
  return (
    <form onSubmit={submit}>
      <label>
        Name <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit">Greet</button>
      {greeted && <p>Hello, {greeted}</p>}
    </form>
  );
};

export const Modal = ({ children }: { children: React.ReactNode }) =>
  createPortal(
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- open でない <dialog> はアクセシビリティツリーに出ない
    <div role="dialog">{children}</div>,
    document.body
  );

// Server から渡された Promise を Client で use() する
export const UserName = ({ user }: { user: Promise<string> }) => (
  <span>User: {use(user)}</span>
);

// SSR と Client で表示が変わる（Hydration Mismatch の検出用）
export const Phase = () => (
  <i>{(globalThis as typeof globalThis & { __phase?: string }).__phase}</i>
);
