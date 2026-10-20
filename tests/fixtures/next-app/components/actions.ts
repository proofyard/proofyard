"use server";

export async function renameUser(teamId: string, userId: number, formData: FormData) {
  return { teamId, userId, name: formData.get("name") };
}
