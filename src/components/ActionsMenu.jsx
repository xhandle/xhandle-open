import React, { useEffect, useRef } from "react";

export default function ActionsMenu({ label, className = "", children }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const menu = menuRef.current;
    const doc = menu.ownerDocument;
    const closeOutside = (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    };
    const handleFocus = (event) => {
      // Safari may blur the summary without focusing a clicked button.
      // Only a concrete focus destination outside the menu dismisses it.
      if (event.target !== doc.body && event.target !== doc.documentElement) closeOutside(event);
    };
    const handleKeyDown = (event) => {
      if (menu.open && event.key === "Escape") {
        menu.open = false;
        menu.querySelector("summary")?.focus();
        event.stopPropagation();
      }
    };
    // Native listeners also cover controls rendered into the menu by a portal.
    doc.addEventListener("pointerdown", closeOutside, true);
    doc.addEventListener("focusin", handleFocus, true);
    doc.addEventListener("keydown", handleKeyDown, true);
    return () => {
      doc.removeEventListener("pointerdown", closeOutside, true);
      doc.removeEventListener("focusin", handleFocus, true);
      doc.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return (
    <details ref={menuRef} className={`relative ${className}`}>
      <summary
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md text-xl font-bold leading-none text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2D7DFE] [&::-webkit-details-marker]:hidden"
        aria-label={label}
        title={label}
      >
        ⋮
      </summary>
      {children}
    </details>
  );
}
