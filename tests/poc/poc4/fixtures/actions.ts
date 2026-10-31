"use server";
/* oxlint-disable require-await -- Server Action は async の関数でなければならない */
import { db } from "./db";

export interface State {
  message?: string;
  error?: string;
}

export const createUser = async (
  _prev: State,
  formData: FormData
): Promise<State> => {
  // テストが止めている間は完了しない（pending 状態の確認用）
  await db.gate;
  const name = formData.get("name");
  if (typeof name !== "string" || name === "") {
    return { error: "Name is required" };
  }
  db.users.push(name);
  return { message: `Created ${name}` };
};

export const joinTeam = async (team: string, user: string) =>
  `${user} joined ${team}`;

export const echo = async <T>(value: T): Promise<T> => value;

export const leak = async () => () => "functions are not serializable";
