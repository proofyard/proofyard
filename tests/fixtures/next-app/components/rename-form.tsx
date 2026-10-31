"use client";

export const RenameForm = ({
  action,
}: {
  action: (formData: FormData) => Promise<unknown>;
}) => (
  <form action={action}>
    <input name="name" />
  </form>
);
