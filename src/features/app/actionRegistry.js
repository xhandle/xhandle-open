const REGISTRY_KEY = "__xhandle_action_registry__";
const CHANGE_EVENT = "xhandle:action-registry-changed";

function getRegistry() {
  if (typeof window === "undefined") return new Map();
  if (!window[REGISTRY_KEY]) {
    window[REGISTRY_KEY] = new Map();
  }
  return window[REGISTRY_KEY];
}

export function registerActionProvider(scope, provider) {
  const registry = getRegistry();
  registry.set(scope, provider);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { scope } }));
  }
  return () => unregisterActionProvider(scope, provider);
}

export function unregisterActionProvider(scope, provider) {
  const registry = getRegistry();
  const current = registry.get(scope);
  if (!provider || current === provider) {
    registry.delete(scope);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { scope } }));
    }
  }
}

export function getActionProvider(scope) {
  const registry = getRegistry();
  return registry.get(scope) || null;
}

export function waitForActionProvider(scope, timeoutMs = 1500) {
  const current = getActionProvider(scope);
  if (current) return Promise.resolve(current);
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let done = false;
    const finish = (provider) => {
      if (done) return;
      done = true;
      window.removeEventListener(CHANGE_EVENT, onChange);
      clearTimeout(timer);
      resolve(provider || null);
    };
    const onChange = (event) => {
      if (event?.detail?.scope !== scope) return;
      finish(getActionProvider(scope));
    };
    const timer = setTimeout(() => finish(getActionProvider(scope)), timeoutMs);
    window.addEventListener(CHANGE_EVENT, onChange);
  });
}
