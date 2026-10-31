// ダミーのフォントのファイル（adjustFontFallback: false。中身の解析の失敗は Next.js のローダーが警告するだけで、next build も通る）
import localFont from "next/font/local";

const brand = localFont({
  adjustFontFallback: false,
  src: "./brand.woff2",
  variable: "--font-brand",
});

const Fonts = () => (
  <p
    className={`${brand.className} ${brand.variable}`}
    data-family={brand.style.fontFamily}
  >
    Branded
  </p>
);
export default Fonts;
