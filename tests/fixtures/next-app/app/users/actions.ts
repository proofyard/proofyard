"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../components/users/db";

export async function addUser(formData: FormData) {
  db.users.push(String(formData.get("name")));
  revalidatePath("/users");
}

export async function addAndOpen(formData: FormData) {
  const name = String(formData.get("name"));
  db.users.push(name);
  redirect(`/users/${name}`);
}
