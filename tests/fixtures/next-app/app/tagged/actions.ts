"use server";
import { updateTag } from "next/cache";
import { db } from "../../components/users/db";

export async function bumpTagged() {
  db.tagged++;
  updateTag("tagged");
}
