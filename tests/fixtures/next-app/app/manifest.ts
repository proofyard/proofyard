import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    display: "standalone",
    icons: [{ sizes: "any", src: "/icon.svg", type: "image/svg+xml" }],
    name: "Proofyard fixture",
    short_name: "Fixture",
    start_url: "/",
  };
}
