// permanentRedirect()（308）
import { permanentRedirect } from "next/navigation";

export default function Moved() {
  permanentRedirect("/users/Alice");
}
