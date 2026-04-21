/**
 * xHandle: top nav bar layout component.
 * This file defines a reusable layout element that helps organize navigation and framing inside the xHandle workspace.
 * Layout components keep the rest of the application focused on engineering content instead of repeating shell-level structure and interaction patterns.
 * Related files: src/App.js, src/components/modals/ReadmeModal.js.
 */

// TopNavBar.jsx
import { Settings } from "lucide-react";
import UserProfileButton from "../common/UserProfileButton";

export default function TopNavBar({
  onUpgrade,
  onOpenSettings,
  onOpenReadme,
  onSignOut,
  rightActions,
}) {
  return (
    <header
      className="
        sticky top-0 z-50 border-b
        bg-white/90 supports-[backdrop-filter]:bg-white/70 backdrop-blur
        dark:bg-black/90 supports-[backdrop-filter]:dark:bg-black/70
        dark:border-zinc-800
      "
    >
      <div className="mx-auto max-w-full px-3 py-2 flex items-center justify-between gap-3">
        {/* LEFT: logo */}
        <div className="flex items-center gap-2 shrink-0">
          <img src="xHandle_Logo.PNG" className="h-5 w-auto" alt="xHandle" />
          <span className="text-sm font-semibold hidden sm:inline text-gray-800 dark:text-zinc-100"></span>
        </div>

        {/* CENTER: spacer */}
        <div className="flex-1" />

        {/* RIGHT: actions */}
        <div className="relative flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onOpenReadme}
            title="Open README"
            className="inline-flex items-center gap-2 h-8 px-3 rounded-md border
                       text-xs font-medium transition shrink-0
                       hover:bg-gray-100 dark:hover:bg-zinc-800
                       border-gray-200 dark:border-zinc-700
                       text-gray-700 dark:text-zinc-100"
          >
            <span>README</span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {rightActions}
          </div>

          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={onOpenSettings}
            className="p-2 rounded text-gray-700 hover:bg-gray-100 dark:text-zinc-100 dark:hover:bg-zinc-800 border border-transparent dark:border-zinc-800/60 shrink-0"
          >
            <Settings size={18} className="shrink-0" />
          </button>

          <UserProfileButton onSignOut={onSignOut} />
        </div>
      </div>
    </header>
  );
}
