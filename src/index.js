/**
 * xHandle: index module.
 * This file provides supporting logic for the xHandle codebase.
 * It participates in the broader local-first architecture by isolating one focused concern that other modules can build on.
 * Related files: src/App.js.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import { LicenseProvider } from "./license/LicenseContext";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <LicenseProvider>
      <App />
    </LicenseProvider>
  </React.StrictMode>
);

reportWebVitals();
