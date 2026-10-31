import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { LikeButton } from "./like-button";

const UserPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) => {
  const { id } = await params;
  const { tab } = await searchParams;
  if (id === "missing") {
    notFound();
  }
  if (id === "boom") {
    throw new Error("user load failed");
  }
  const cookieStore = await cookies();
  const theme = cookieStore.get("theme")?.value ?? "light";
  return (
    <article>
      <h1>User {id}</h1>
      <p>tab: {tab ?? "none"}</p>
      <p>theme: {theme}</p>
      <LikeButton initial={3} />
    </article>
  );
};

export default UserPage;
