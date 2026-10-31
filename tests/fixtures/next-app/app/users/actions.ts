"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "../../components/users/db";

// oxlint-disable-next-line eslint/require-await -- Server Action は async 関数にする必要がある
export const addUser = async (formData: FormData) => {
  db.users.push(String(formData.get("name")));
  revalidatePath("/users");
};

// oxlint-disable-next-line eslint/require-await -- Server Action は async 関数にする必要がある
export const addAndOpen = async (formData: FormData) => {
  const name = String(formData.get("name"));
  db.users.push(name);
  redirect(`/users/${name}`);
};
