import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { migrateLegacyStorageKeys } from "./browser-storage-migration";

// Copy preferences saved under the legacy (pre-rename) keys before the application reads them.
migrateLegacyStorageKeys();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
