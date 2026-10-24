import type { NextConfig } from "next";

// basePath と trailingSlash（すべての URL に効く）、forbidden() / unauthorized()（experimental.authInterrupts）
const config: NextConfig = {
  basePath: "/base",
  trailingSlash: true,
  experimental: { authInterrupts: true },
};
export default config;
