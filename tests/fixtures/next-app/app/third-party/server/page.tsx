import label, { env } from "fake-server-lib";

const Page = () => (
  <p>
    {label()} ({env})
  </p>
);
export default Page;
