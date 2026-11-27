import QuickSearch from "./QuickSearch.js";
// TopNavBar.jsx
import { Settings } from "lucide-react";
import UserProfileButton from "./UserProfileButton";

export default function TopNavBar({
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
      "
    >
      <div className="mx-auto max-w-full px-3 py-2 flex items-center justify-between gap-3">
        {/* LEFT: logo */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="relative inline-flex h-5">
            <img src="xHandle_Logo.PNG" className="h-5 w-auto" alt="xHandle" />
            {/* Tint only the wordmark, preserving the colored x in both themes. */}
            <img
              src="xHandle_Logo.PNG"
              className="pointer-events-none absolute inset-0 hidden h-full w-full brightness-0 invert dark:block"
              style={{ clipPath: "inset(0 0 0 20%)" }}
              alt=""
              aria-hidden="true"
            />
          </span>
        </div>

        {/* CENTER: spacer */}
        <div className="flex-1" />

        {/* RIGHT: actions */}
        <div className="relative flex items-center gap-3 shrink-0">
          <QuickSearch />
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
