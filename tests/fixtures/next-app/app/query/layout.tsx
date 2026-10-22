import { QueryProvider } from "../../components/query";

export default function QueryLayout({ children }: { children: React.ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
