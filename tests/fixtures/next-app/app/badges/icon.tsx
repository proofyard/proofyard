// generateImageMetadata: 1 つのファイルから複数のアイコン（/badges/icon/small など）
import { ImageResponse } from "next/og";

export function generateImageMetadata() {
  return [
    { id: "small", size: { width: 16, height: 16 }, contentType: "image/png" },
    { id: "large", size: { width: 48, height: 48 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = (await id) === "small" ? 16 : 48;
  return new ImageResponse(<div style={{ display: "flex", width: size, height: size, background: "teal" }} />, { width: size, height: size });
}
