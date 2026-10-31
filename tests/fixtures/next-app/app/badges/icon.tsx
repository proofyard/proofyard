// generateImageMetadata: 1 つのファイルから複数のアイコン（/badges/icon/small など）
import { ImageResponse } from "next/og";

export const generateImageMetadata = () => [
  { contentType: "image/png", id: "small", size: { height: 16, width: 16 } },
  { contentType: "image/png", id: "large", size: { height: 48, width: 48 } },
];

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = (await id) === "small" ? 16 : 48;
  return new ImageResponse(
    <div
      style={{ background: "teal", display: "flex", height: size, width: size }}
    />,
    { height: size, width: size }
  );
}
