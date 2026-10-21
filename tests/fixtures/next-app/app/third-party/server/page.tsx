import label, { env } from "fake-server-lib";

export default function Page() {
  return (
    <p>
      {label()} ({env})
    </p>
  );
}
