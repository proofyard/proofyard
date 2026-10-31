import { cookies } from "next/headers";
import { unauthorized } from "next/navigation";

const Account = async () => {
  const cookieStore = await cookies();
  if (!cookieStore.get("session")) {
    unauthorized();
  }
  return <h1>Account</h1>;
};
export default Account;
