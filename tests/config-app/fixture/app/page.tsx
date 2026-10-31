import Link from "next/link";

import { CurrentPath } from "../components/current-path";

const Home = () => (
  <main>
    <h1>Config home</h1>
    <Link href="/about">About</Link>
    <CurrentPath />
  </main>
);
export default Home;
