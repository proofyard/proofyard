import type { NextConfig } from "next";

const config: NextConfig = {
  async redirects() {
    return [{ source: "/members", destination: "/users", permanent: true }];
  },
  async rewrites() {
    return [{ source: "/people/:name", destination: "/users/:name" }];
  },
  async headers() {
    return [{ source: "/users/:path*", headers: [{ key: "x-section", value: "users" }] }];
  },
};
export default config;
