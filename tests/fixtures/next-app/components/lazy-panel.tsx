"use client";
import dynamic from "next/dynamic";
import { useState } from "react";

// next/dynamic（ssr: false はブラウザだけで読む）と import()
const Chart = dynamic(() => import("./chart").then((m) => m.Chart), { ssr: false, loading: () => <p>Loading chart</p> });
const Notes = dynamic(() => import("./notes"));

export function LazyPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <Chart />
      <button onClick={() => setOpen(true)}>Open notes</button>
      {open && <Notes />}
    </section>
  );
}
