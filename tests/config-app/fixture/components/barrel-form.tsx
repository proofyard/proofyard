import { useState } from "react";
import { Used } from "fake-barrel";

// "use client" はないが Client Component からだけ import される（rsc 層でコンパイルすると useState で失敗する）
export function BarrelForm() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open form</button>
      {open && <Used />}
    </div>
  );
}
