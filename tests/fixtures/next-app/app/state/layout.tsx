import Link from "next/link";

import { ReduxProvider, Stores } from "../../components/state-stores";

const StateLayout = ({ children }: { children: React.ReactNode }) => (
  <ReduxProvider>
    <Stores />
    <Link href="/state/other">Other</Link>
    {children}
  </ReduxProvider>
);
export default StateLayout;
