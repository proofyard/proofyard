import type { NextConfig } from "next";

const config: NextConfig = {
  // oxlint-disable-next-line eslint/require-await -- Next.js の設定は Promise を返す関数にする
  async headers() {
    return [
      {
        headers: [{ key: "x-section", value: "users" }],
        source: "/users/:path*",
      },
    ];
  },
  // oxlint-disable-next-line eslint/require-await -- Next.js の設定は Promise を返す関数にする
  async redirects() {
    return [{ destination: "/users", permanent: true, source: "/members" }];
  },
  // oxlint-disable-next-line eslint/require-await -- Next.js の設定は Promise を返す関数にする
  async rewrites() {
    return [{ destination: "/users/:name", source: "/people/:name" }];
  },
};
export default config;
