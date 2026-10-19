export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>root layout</header>
        {children}
      </body>
    </html>
  );
}
