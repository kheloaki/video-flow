import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { InstallAppPrompt } from "./InstallAppPrompt.tsx";
import { RootErrorBoundary } from "./RootErrorBoundary.tsx";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element in index.html");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

createRoot(rootEl).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
      <InstallAppPrompt />
    </RootErrorBoundary>
  </StrictMode>
);
