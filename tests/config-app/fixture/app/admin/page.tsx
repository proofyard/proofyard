import { cookies } from "next/headers";
import { forbidden } from "next/navigation";

const Admin = async () => {
  const cookieStore = await cookies();
  if (cookieStore.get("role")?.value !== "admin") {
    forbidden();
  }
  return <h1>Admin area</h1>;
};
export default Admin;
