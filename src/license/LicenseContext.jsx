// src/license/LicenseContext.jsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const LOCAL_OPEN_SOURCE_ENTITLEMENTS = {
  agentic_reports: true,
  advanced_exports: true,
  requirements_manager: true,
  risk_register: true,
  ai_pm: true,
  max_projects: 999999,
};

const LicenseCtx = createContext({
  ok: true,
  plan: "local",
  status: "local-open-source",
  seats: 0,
  expiresAt: null,
  entitlements: LOCAL_OPEN_SOURCE_ENTITLEMENTS,
  loading: false,
  error: null,
  refresh: async () => {},
  activate: async (_code) => {},
  canCreateAnotherProject: async () => ({ ok: true, count: 0, limit: Infinity }),
  createProject: async (_args) => ({ data: null, error: new Error("uninitialized") }),
});

export function LicenseProvider({ children }) {
  const [state, setState] = useState({
    ok: true,
    plan: "local",
    status: "local-open-source",
    seats: 0,
    expiresAt: null,
    entitlements: LOCAL_OPEN_SOURCE_ENTITLEMENTS,
    loading: false,
    error: null,
  });

  /** Local open-source entitlement status. */
  const refresh = useCallback(async () => {
    setState({
      ok: true,
      plan: "local",
      status: "local-open-source",
      seats: 0,
      expiresAt: null,
      entitlements: LOCAL_OPEN_SOURCE_ENTITLEMENTS,
      loading: false,
      error: null,
    });
  }, []);

  const activate = useCallback(
    async (code) => {
      await refresh();
      return { ok: true, plan: "local", status: "local-open-source", code };
    },
    [refresh]
  );

  const canCreateAnotherProject = useCallback(async () => {
    return { ok: true, count: 0, limit: LOCAL_OPEN_SOURCE_ENTITLEMENTS.max_projects };
  }, []);

  const createProject = useCallback(
    async ({ name }) => {
      if (!name || !String(name).trim()) {
        return { data: null, error: new Error("Enter a project name") };
      }

      const cap = await canCreateAnotherProject();
      if (!cap.ok) {
        return {
          data: null,
          error: new Error(
            `You have reached the local project limit of ${cap.limit}.`
          ),
        };
      }

      const data = { id: `${Date.now()}`, name: String(name).trim(), createdAt: new Date().toISOString() };
      return { data, error: null };
    },
    [canCreateAnotherProject]
  );

  // Initial load + one light retry if it starts as not ok
  useEffect(() => {
    let cancel = false;

    (async () => {
      await refresh();
      setTimeout(async () => {
        if (!cancel && !state.ok) await refresh();
      }, 3000);
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      refresh,
      activate,
      canCreateAnotherProject,
      createProject,
    }),
    [state, refresh, activate, canCreateAnotherProject, createProject]
  );

  return <LicenseCtx.Provider value={value}>{children}</LicenseCtx.Provider>;
}

export const useLicense = () => useContext(LicenseCtx);

export function hasFeature(entitlements, key) {
  const v = entitlements?.[key];
  return typeof v === "boolean" ? v : Boolean(v);
}

export function Gate({ children }) {
  return <>{children}</>;
}
