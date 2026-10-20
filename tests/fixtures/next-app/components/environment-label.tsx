"use client";

// サーバーとブラウザで違う表示になる（Hydration Mismatch の確認用）
export function EnvironmentLabel() {
  return <p>rendered on {typeof window === "undefined" ? "server" : "client"}</p>;
}
