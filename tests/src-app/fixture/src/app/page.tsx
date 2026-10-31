import { Greeting } from "@/components/greeting";
import { siteName } from "@/lib/site";

const Home = () => (
  <>
    <h1>{siteName}</h1>
    <Greeting />
  </>
);
export default Home;
