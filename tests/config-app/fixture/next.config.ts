import type { NextConfig } from "next";

// basePath と trailingSlash（すべての URL に効く）、forbidden() / unauthorized()（experimental.authInterrupts）、
// optimizePackageImports（node_modules の fake-barrel）、reactCompiler
const config: NextConfig = {
  basePath: "/base",
  trailingSlash: true,
  reactCompiler: true,
  experimental: { authInterrupts: true, optimizePackageImports: ["fake-barrel"] },
};
export default config;
