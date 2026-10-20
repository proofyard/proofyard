"use client";

export function RenameForm({ action }: { action: (formData: FormData) => Promise<unknown> }) {
  return (
    <form action={action}>
      <input name="name" />
    </form>
  );
}
