"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <h1>Global failure</h1>
        <button type="button" onClick={() => reset()}>
          Retry
        </button>
      </body>
    </html>
  );
}
