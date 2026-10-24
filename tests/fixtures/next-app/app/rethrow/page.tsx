// unstable_rethrow: try / catch の中の Next.js の制御（notFound など）は投げ直す
import { notFound, unstable_rethrow } from "next/navigation";

export default async function Rethrow({ searchParams }: { searchParams: Promise<{ missing?: string }> }) {
  try {
    if ((await searchParams).missing) notFound();
    return <h1>Found</h1>;
  } catch (error) {
    unstable_rethrow(error);
    return <h1>Swallowed</h1>;
  }
}
