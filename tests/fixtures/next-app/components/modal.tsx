"use client";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Modal({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open {title}
      </button>
      {open &&
        createPortal(
          <div role="dialog" aria-label={title}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
