import { Used } from "fake-barrel";
import { useState } from "react";

// "use client" はないが Client Component からだけ import される（rsc 層でコンパイルすると useState で失敗する）
export const BarrelForm = () => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open form
      </button>
      {open && <Used />}
    </div>
  );
};
