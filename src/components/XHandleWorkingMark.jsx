import React from "react";

export default function XHandleWorkingMark({ className = "h-4 w-4" }) {
  return (
    <span className={`xhandle-working-mark inline-flex shrink-0 items-center justify-center ${className}`} aria-hidden="true">
      <img
        src="/favicon.png"
        alt=""
        draggable={false}
        decoding="async"
        className="h-full w-full object-contain"
      />
    </span>
  );
}
