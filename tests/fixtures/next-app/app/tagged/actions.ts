"use server";
import { updateTag } from "next/cache";

import { db } from "../../components/users/db";

// oxlint-disable-next-line eslint/require-await -- Server Action は async 関数にする必要がある
export const bumpTagged = async () => {
  db.tagged += 1;
  updateTag("tagged");
};
