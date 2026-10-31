import { db } from "../../components/users/db";

const DashboardHome = () => (
  <>
    <h1>Dashboard</h1>
    <p>{db.users.length} users</p>
  </>
);
export default DashboardHome;
