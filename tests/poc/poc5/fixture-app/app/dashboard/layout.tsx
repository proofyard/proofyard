import { headers } from "next/headers";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ua = (await headers()).get("user-agent");
  return (
    <section>
      <nav>dashboard nav ({ua})</nav>
      {children}
    </section>
  );
}
