import type { Metadata } from "next";

export const metadata: Metadata = {
  description: "Proofyard fixture",
  title: { default: "Fixture", template: "%s | Fixture" },
};

const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <body>{children}</body>
  </html>
);
export default RootLayout;
