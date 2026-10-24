// リクエストのときに描画するページの next/font（next start は preload を HTML の <link> ではなく Link ヘッダーで返す）
import localFont from "next/font/local";
import { connection } from "next/server";

const brand = localFont({ src: "../brand.woff2", adjustFontFallback: false });

export default async function LiveFonts() {
  await connection();
  return <p className={brand.className}>Live</p>;
}
