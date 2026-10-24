import { forbidden } from "next/navigation";
import { cookies } from "next/headers";

export default async function Admin() {
  if ((await cookies()).get("role")?.value !== "admin") forbidden();
  return <h1>Admin area</h1>;
}
