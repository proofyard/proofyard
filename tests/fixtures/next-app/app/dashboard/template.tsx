import { Counter } from "../../components/counter";

export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Counter label="Template clicks" />
      {children}
    </div>
  );
}
