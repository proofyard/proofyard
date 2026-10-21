import Link from "next/link";
import { Counter } from "../../components/counter";
import { CurrentPath } from "../../components/current-path";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <section>
      <nav>
        <Link href="/dashboard">Home</Link>
        <Link href="/dashboard/settings">Settings</Link>
        <Link href="/slow">Slow</Link>
      </nav>
      <CurrentPath />
      <Counter label="Layout clicks" />
      {children}
    </section>
  );
}
