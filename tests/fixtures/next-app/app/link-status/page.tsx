import Link from "next/link";

import { PendingHint } from "../../components/pending-hint";

const LinkStatus = () => (
  <Link href="/pending-target">
    Open target <PendingHint />
  </Link>
);
export default LinkStatus;
