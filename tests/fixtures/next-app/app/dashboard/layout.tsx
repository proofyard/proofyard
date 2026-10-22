import Link from "next/link";
import { Suspense } from "react";
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
      {/* useSearchParams() は Suspense の中（ないと next build の静的な描画がエラーになる） */}
      <Suspense fallback={<p>Loading path</p>}>
        <CurrentPath />
      </Suspense>
      <Counter label="Layout clicks" />
      {children}
    </section>
  );
}
