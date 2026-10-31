import { Counter } from "../../components/counter";

const DashboardTemplate = ({ children }: { children: React.ReactNode }) => (
  <div>
    <Counter label="Template clicks" />
    {children}
  </div>
);
export default DashboardTemplate;
