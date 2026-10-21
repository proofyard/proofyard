"use client";
export function EnvLabel() {
  return <p>Client label: {process.env.NEXT_PUBLIC_SITE_LABEL}</p>;
}
