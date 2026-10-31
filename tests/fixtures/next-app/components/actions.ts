"use server";

// oxlint-disable-next-line eslint/require-await -- Server Action は async 関数にする必要がある
export const renameUser = async (
  teamId: string,
  userId: number,
  formData: FormData
) => ({ name: formData.get("name"), teamId, userId });
