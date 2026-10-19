import { redirect } from "next/navigation";

export default function Go() {
  redirect("/dashboard/users/1");
}
