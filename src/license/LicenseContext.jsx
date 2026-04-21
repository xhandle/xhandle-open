/**
 * xHandle: license context licensing workflow.
 * This file implements part of the optional licensing layer that gates premium or deployment-sensitive behaviors in xHandle.
 * Licensing is kept separate from the main engineering flows so the core workspace stays understandable while still supporting activation and entitlement checks when needed.
 * Related files: server/license/routes.js, server/license/issue.js, src/App.js.
 */

// src/license/LicenseContext.jsx
import React, { createContext, useContext, useMemo } from "react";

/**
 * deriveEntitlements renders a React component. It gives users access to license activation and entitlement feedback while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param plan Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function deriveEntitlements(plan) {
  const proDefaults = {
    agentic_reports: true,
    advanced_exports: true,
    requirements_manager: true,
    risk_register: true,
    ai_pm: true,
    max_projects: 9999,
  };

  const freeDefaults = {
    agentic_reports: false,
    advanced_exports: false,
    requirements_manager: false,
    risk_register: false,
    ai_pm: false,
    max_projects: 3,
  };

  return plan === "pro" ? proDefaults : freeDefaults;
}

const LicenseCtx = createContext({
  ok: true,
  plan: "open-source",
  status: "active",
  seats: 1,
  expiresAt: null,
  entitlements: deriveEntitlements("pro"),
  loading: false,
  error: null,
  refresh: async () => {},
  activate: async () => ({ ok: true }),
  canCreateAnotherProject: async () => ({
    ok: true,
    count: 0,
    limit: 9999,
  }),
  createProject: async ({ name }) => ({
    data: {
      id: `${Date.now()}`,
      name,
    },
    error: null,
  }),
});

/**
 * LicenseProvider renders a React component. It gives users access to license activation and entitlement feedback while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param children Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
export function LicenseProvider({ children }) {
  const value = useMemo(
    () => ({
      ok: true,
      plan: "open-source",
      status: "active",
      seats: 1,
      expiresAt: null,
      entitlements: deriveEntitlements("pro"),
      loading: false,
      error: null,

      refresh: async () => {},

      activate: async () => {
        return { ok: true, plan: "open-source" };
      },

      canCreateAnotherProject: async () => {
        try {
          const raw = localStorage.getItem("xhandle.projects");
          const projects = raw ? JSON.parse(raw) : [];
          const limit = 9999;
          const count = Array.isArray(projects) ? projects.length : 0;
          return { ok: count < limit, count, limit };
        } catch {
          return { ok: true, count: 0, limit: 9999 };
        }
      },

      createProject: async ({ name }) => {
        if (!name || !String(name).trim()) {
          return { data: null, error: new Error("Enter a project name") };
        }

        return {
          data: {
            id: `${Date.now()}`,
            name: String(name).trim(),
          },
          error: null,
        };
      },
    }),
    []
  );

  return <LicenseCtx.Provider value={value}>{children}</LicenseCtx.Provider>;
}

/**
 * useLicense renders a React component. It gives users access to license activation and entitlement feedback while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
export const useLicense = () => useContext(LicenseCtx);

/**
 * hasFeature renders a React component. It gives users access to license activation and entitlement feedback while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param entitlements Input consumed by this step of the xHandle workflow.
 * @param key Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
export function hasFeature(entitlements, key) {
  const v = entitlements?.[key];
  return typeof v === "boolean" ? v : Boolean(v);
}

/**
 * Gate renders a React component. It gives users access to license activation and entitlement feedback while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param feature Input consumed by this step of the xHandle workflow.
 * @param children Input consumed by this step of the xHandle workflow.
 * @param fallback Input consumed by this step of the xHandle workflow.
 * @param loadingFallback Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
export function Gate({ feature, children, fallback = null, loadingFallback = null }) {
  const lic = useLicense();
  if (lic.loading) return <>{loadingFallback}</>;
  return hasFeature(lic.entitlements, feature) ? <>{children}</> : <>{fallback}</>;
}