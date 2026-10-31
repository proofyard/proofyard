"use client";

const GlobalError = ({ reset }: { error: Error; reset: () => void }) => (
  <html lang="en">
    <body>
      <h1>Global failure</h1>
      <button type="button" onClick={() => reset()}>
        Retry
      </button>
    </body>
  </html>
);
export default GlobalError;
