import { Greeting } from "@/components/greeting";
import { siteName } from "@/lib/site";

export default function Home() {
  return (
    <>
      <h1>{siteName}</h1>
      <Greeting />
    </>
  );
}
