import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "Proofyard fixture", short_name: "Fixture", start_url: "/", display: "standalone", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] };
}
