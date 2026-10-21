import { db } from "../../components/users/db";

export default function DashboardHome() {
  return (
    <>
      <h1>Dashboard</h1>
      <p>{db.users.length} users</p>
    </>
  );
}
