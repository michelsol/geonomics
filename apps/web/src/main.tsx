// Web app entry point. The interface is built from roadmap stage 8.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <h1>GeoTrade</h1>
  </StrictMode>,
);
