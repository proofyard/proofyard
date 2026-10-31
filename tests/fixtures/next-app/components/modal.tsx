"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export const Modal = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open {title}
      </button>
      {open &&
        createPortal(
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <dialog> にすると描画する markup が変わる
          <div role="dialog" aria-label={title}>
            {children}
          </div>,
          document.body
        )}
    </>
  );
};
