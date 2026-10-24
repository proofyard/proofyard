import { unauthorized } from "next/navigation";
import { cookies } from "next/headers";

export default async function Account() {
  if (!(await cookies()).get("session")) unauthorized();
  return <h1>Account</h1>;
}
