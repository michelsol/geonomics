// Web app entry point: starts the simulation worker, or joins a hosted game from a join link, and renders the
// interface.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { routeWorkerMessage } from "./net/host";
import { joinTarget } from "./net/options";
import { connectWorker } from "./state/store";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const host = joinTarget();
if (host) void import("./net/client").then((client) => client.connectClient(host));
else
  connectWorker(new Worker(new URL("./host/sim.worker.ts", import.meta.url), { type: "module" }), routeWorkerMessage);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
