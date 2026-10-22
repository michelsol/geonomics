// Web app entry point: starts the simulation worker and renders the interface.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { connectWorker } from "./state/store";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

connectWorker(new Worker(new URL("./host/sim.worker.ts", import.meta.url), { type: "module" }));

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
