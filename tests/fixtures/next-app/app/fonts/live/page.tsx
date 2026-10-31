// リクエストのときに描画するページの next/font（next start は preload を HTML の <link> ではなく Link ヘッダーで返す）
import localFont from "next/font/local";
import { connection } from "next/server";

const brand = localFont({ adjustFontFallback: false, src: "../brand.woff2" });

const LiveFonts = async () => {
  await connection();
  return <p className={brand.className}>Live</p>;
};
export default LiveFonts;
