"use server";
import { db } from "./db";

export type State = { message?: string; error?: string };

export async function createUser(_prev: State, formData: FormData): Promise<State> {
  await db.gate; // テストが止めている間は完了しない（pending の確認用）
  const name = formData.get("name");
  if (typeof name !== "string" || name === "") return { error: "Name is required" };
  db.users.push(name);
  return { message: `Created ${name}` };
}

export async function joinTeam(team: string, user: string) {
  return `${user} joined ${team}`;
}

export async function echo<T>(value: T): Promise<T> {
  return value;
}

export async function leak() {
  return () => "functions are not serializable";
}

export async function fail() {
  throw new Error("action failed on the server");
}

export async function like() {
  await db.gate;
  db.likes += 1;
  return db.likes;
}
