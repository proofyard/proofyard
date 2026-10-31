import { Used, fromWildcard } from "fake-barrel";

import { BarrelClient } from "../../components/barrel-client";

const BarrelPage = () => (
  <main>
    <h1>{fromWildcard}</h1>
    <Used />
    <BarrelClient />
  </main>
);
export default BarrelPage;
