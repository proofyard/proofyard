import Link from "next/link";
import { PendingHint } from "../../components/pending-hint";

export default function LinkStatus() {
  return (
    <Link href="/pending-target">
      Open target <PendingHint />
    </Link>
  );
}
