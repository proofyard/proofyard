import type { NextConfig } from "next";

// basePath と trailingSlash（すべての URL に効く）、forbidden() / unauthorized()（experimental.authInterrupts）、
// optimizePackageImports（node_modules の fake-barrel）、reactCompiler
const config: NextConfig = {
  basePath: "/base",
  experimental: {
    authInterrupts: true,
    optimizePackageImports: ["fake-barrel"],
  },
  reactCompiler: true,
  trailingSlash: true,
};
export default config;
