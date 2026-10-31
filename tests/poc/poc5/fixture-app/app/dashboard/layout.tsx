import { headers } from "next/headers";

const DashboardLayout = async ({ children }: { children: React.ReactNode }) => {
  const requestHeaders = await headers();
  const ua = requestHeaders.get("user-agent");
  return (
    <section>
      <nav>dashboard nav ({ua})</nav>
      {children}
    </section>
  );
};

export default DashboardLayout;
