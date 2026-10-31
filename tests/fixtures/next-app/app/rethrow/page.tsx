// unstable_rethrow: try / catch の中の Next.js の制御（notFound など）は投げ直す
import { notFound, unstable_rethrow } from "next/navigation";

const Rethrow = async ({
  searchParams,
}: {
  searchParams: Promise<{ missing?: string }>;
}) => {
  try {
    const { missing } = await searchParams;
    if (missing) {
      notFound();
    }
  } catch (error) {
    unstable_rethrow(error);
    return <h1>Swallowed</h1>;
  }
  return <h1>Found</h1>;
};
export default Rethrow;
