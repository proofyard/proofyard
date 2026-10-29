// top-level await のあるモジュール（Next.js は async module として扱う）。すぐに終わらない await（logtape の configure など）
await new Promise((resolve) => setTimeout(resolve, 1));
export const tlaValue = "From top-level await";
