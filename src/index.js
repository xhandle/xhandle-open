import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { installAIRequestAuthShim } from "./lib/installAIRequestAuthShim";

installAIRequestAuthShim();

if (typeof window !== "undefined" && typeof window.ResizeObserver === "function") {
  const NativeResizeObserver = window.ResizeObserver;
  window.ResizeObserver = class ResizeObserver extends NativeResizeObserver {
    constructor(callback) {
      super((entries, observer) => {
        window.requestAnimationFrame(() => callback(entries, observer));
      });
    }
  };

  const suppressResizeObserverOverlay = (event) => {
    const message = event?.message || event?.reason?.message || "";
    if (
      message.includes("ResizeObserver loop completed with undelivered notifications") ||
      message.includes("ResizeObserver loop limit exceeded")
    ) {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
    }
  };

  window.addEventListener("error", suppressResizeObserverOverlay);
  window.addEventListener("unhandledrejection", suppressResizeObserverOverlay);
}

if (process.env.REACT_APP_XHANDLE_REVIEW_MODE === "true") {
  require("./review-entry");
} else {
  const App = require("./App").default;
  const reportWebVitals = require("./reportWebVitals").default;
  const { LicenseProvider } = require("./license/LicenseContext");

  console.log("Backend URL from index.js:", process.env.BACKEND_URL);

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(
    <React.StrictMode>
      <LicenseProvider>
        <App />
      </LicenseProvider>
    </React.StrictMode>
  );

  reportWebVitals();
}
