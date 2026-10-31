const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <body>
      <header>root layout</header>
      {children}
    </body>
  </html>
);

export default RootLayout;
