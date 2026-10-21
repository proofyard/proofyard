"use client";
// サーバーとブラウザで違う内容を描画する（Hydration Mismatch）
export function ClientTime() {
  return <p>Rendered on {typeof window === "undefined" ? "server" : "client"}</p>;
}
