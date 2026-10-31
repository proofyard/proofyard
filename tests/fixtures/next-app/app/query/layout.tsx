import { QueryProvider } from "../../components/query";

const QueryLayout = ({ children }: { children: React.ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);
export default QueryLayout;
