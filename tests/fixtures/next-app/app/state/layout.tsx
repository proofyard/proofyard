import Link from "next/link";
import { ReduxProvider, Stores } from "../../components/state-stores";

export default function StateLayout({ children }: { children: React.ReactNode }) {
  return (
    <ReduxProvider>
      <Stores />
      <Link href="/state/other">Other</Link>
      {children}
    </ReduxProvider>
  );
}
