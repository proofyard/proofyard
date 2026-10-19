"use client";
import { use, useEffect, useLayoutEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

export const effects: string[] = [];

export function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  useLayoutEffect(() => void effects.push(`layout:${count}`), [count]);
  useEffect(() => {
    effects.push(`effect:${count}`);
    return () => void effects.push(`cleanup:${count}`);
  }, [count]);
  return <button onClick={() => setCount((c) => c + 1)}>{label}: {count}</button>;
}

export function Greeting() {
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
}

export function Modal({ children }: { children: React.ReactNode }) {
  return createPortal(<div role="dialog">{children}</div>, document.body);
}

// Server から渡された Promise を Client で use() する
export function UserName({ user }: { user: Promise<string> }) {
  return <span>User: {use(user)}</span>;
}

// SSR と Client で表示が変わる（Hydration Mismatch の検出用）
export function Phase() {
  return <i>{(globalThis as any).__phase}</i>;
}
