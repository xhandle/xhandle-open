import { ChevronLeft, ChevronRight } from "lucide-react";

const BUTTON_TONES = {
  default: "border-gray-200 bg-white text-gray-700 hover:bg-gray-100",
  primary: "border-[#2D7DFE]/30 bg-[#EEF4FF] text-[#0B3EA8] hover:bg-blue-100",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  warning: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
  danger: "border-red-200 bg-white text-red-700 hover:bg-red-50",
};

export default function ProjectTabSideToolbar({
  label,
  collapsed = false,
  onCollapsedChange,
  children,
  className = "",
}) {
  return (
    <aside
      aria-label={label}
      className={`flex min-h-0 shrink-0 flex-col self-stretch overflow-hidden border border-gray-200 bg-[#F8FAFC] transition-[width] duration-200 ${collapsed ? "w-14" : "w-56"} ${className}`}
    >
      <button
        type="button"
        onClick={() => onCollapsedChange?.(!collapsed)}
        className={`flex h-11 shrink-0 items-center border-b border-gray-200 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-100 ${collapsed ? "justify-center" : "justify-between"}`}
        aria-label={collapsed ? `Show ${label}` : `Hide ${label}`}
        title={collapsed ? `Show ${label}` : `Hide ${label}`}
      >
        {!collapsed && <span>Tools</span>}
        {collapsed ? <ChevronRight size={17} aria-hidden="true" /> : <ChevronLeft size={17} aria-hidden="true" />}
      </button>
      <div className={`min-h-0 flex-1 overflow-y-auto ${collapsed ? "p-2" : "p-3"}`}>
        {children}
      </div>
    </aside>
  );
}

export function ProjectTabToolbarSection({ title, collapsed = false, children }) {
  return (
    <section className="border-b border-gray-200 py-3 first:pt-0 last:border-b-0 last:pb-0">
      {!collapsed && (
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </h2>
      )}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function ProjectTabToolbarButton({
  icon,
  label,
  collapsed = false,
  tone = "default",
  className = "",
  ...buttonProps
}) {
  const tooltip = buttonProps.title || label;
  return (
    <button
      type="button"
      {...buttonProps}
      title={tooltip}
      aria-label={collapsed ? label : buttonProps["aria-label"]}
      className={`inline-flex min-h-9 w-full items-center rounded-md border text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${collapsed ? "justify-center px-2" : "gap-2 px-3 py-2 text-left"} ${BUTTON_TONES[tone] || BUTTON_TONES.default} ${className}`}
    >
      <span className="inline-flex shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>
      {!collapsed && <span className="min-w-0 leading-4">{label}</span>}
    </button>
  );
}

export function ProjectTabToolbarField({ label, collapsed = false, children }) {
  if (collapsed) return null;
  return (
    <label className="block text-xs font-medium text-gray-600">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function ProjectTabToolbarStatus({ children, collapsed = false, tone = "default", icon = null, title = "" }) {
  const tones = {
    default: "text-gray-600",
    info: "text-blue-700",
    success: "text-emerald-700",
    error: "text-red-700",
  };
  if (collapsed) {
    if (!icon) return null;
    return (
      <div className={`flex min-h-9 items-center justify-center ${tones[tone] || tones.default}`} title={title} role="status">
        {icon}
      </div>
    );
  }
  return (
    <div className={`flex items-start gap-2 text-xs leading-4 ${tones[tone] || tones.default}`} role="status" aria-live="polite">
      {icon && <span className="mt-0.5 shrink-0" aria-hidden="true">{icon}</span>}
      <span>{children}</span>
    </div>
  );
}
