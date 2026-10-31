"use client";
// サーバーとブラウザで違う内容を描画する（Hydration Mismatch）
export const ClientTime = () => (
  <p>Rendered on {typeof window === "undefined" ? "server" : "client"}</p>
);
