// ダミーのフォントのファイル（adjustFontFallback: false。中身の解析の失敗は Next.js のローダーが警告するだけ）
import localFont from "next/font/local";

const brand = localFont({ src: "./brand.woff2", adjustFontFallback: false, variable: "--font-brand" });

export default function Fonts() {
  return (
    <p className={`${brand.className} ${brand.variable}`} data-family={brand.style.fontFamily}>
      Branded
    </p>
  );
}
