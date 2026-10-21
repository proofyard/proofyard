import { ImageResponse } from "next/og";

export const size = { width: 120, height: 60 };
export const contentType = "image/png";
export const alt = "OG image";

export default function Image() {
  return new ImageResponse(<div style={{ display: "flex", fontSize: 20 }}>OG</div>, size);
}
