"use server";
import { db } from "./db";

export interface State {
  message?: string;
  error?: string;
}

export const createUser = async (
  _prev: State,
  formData: FormData
): Promise<State> => {
  // テストが止めている間は完了しない（pending の確認用）
  await db.gate;
  const name = formData.get("name");
  if (typeof name !== "string" || name === "") {
    return { error: "Name is required" };
  }
  db.users.push(name);
  return { message: `Created ${name}` };
};

// oxlint-disable-next-line eslint/require-await -- Server Action は async 関数にする必要がある
export const joinTeam = async (team: string, user: string) =>
  `${user} joined ${team}`;

// oxlint-disable-next-line eslint/require-await -- Server Action は async 関数にする必要がある
export const echo = async <T>(value: T): Promise<T> => value;

// oxlint-disable-next-line eslint/require-await -- Server Action は async 関数にする必要がある
export const leak = async () => () => "functions are not serializable";

// oxlint-disable-next-line eslint/require-await -- Server Action は async 関数にする必要がある
export const fail = async () => {
  throw new Error("action failed on the server");
};

export const like = async () => {
  await db.gate;
  db.likes += 1;
  return db.likes;
};
