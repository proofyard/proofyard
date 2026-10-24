// next/script: afterInteractive（既定）と lazyOnload、インラインのスクリプト
import Script from "next/script";
import { connection } from "next/server";

export default async function Scripts() {
  await connection();
  return (
    <main>
      <h1>Scripts</h1>
      <Script src="/after.js" />
      <Script src="/lazy.js" strategy="lazyOnload" />
      <Script id="inline-flag">{`document.body.dataset.inline = "ran";`}</Script>
    </main>
  );
}
