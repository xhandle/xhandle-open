import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const DesignActionsContext = createContext(null);
export const useDesignActions = () => useContext(DesignActionsContext);

// The mounted primary editor owns the single toolbar disclosure. Keep the
// original editor's callbacks/state in place; only its trigger moves to the
// toolbar, and workspace actions are composed into that same disclosure.
export function DesignActionsProvider({ children, workspaceActions }) {
  const [host, setHost] = useState(null), [owner, setOwner] = useState(null);
  const register = useCallback(id => {
    setOwner(id);
    return () => setOwner(current => current === id ? null : current);
  }, []);
  const value = useMemo(() => ({ host, setHost, owner, register, workspaceActions }), [host, owner, register, workspaceActions]);
  return <DesignActionsContext.Provider value={value}>{children}</DesignActionsContext.Provider>;
}
