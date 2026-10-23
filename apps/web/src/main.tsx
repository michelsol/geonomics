// Web app entry point: starts the simulation worker, or joins a hosted game from a join link, and renders the
// interface.
import type { SaveInfo } from "@geonomics/sim";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { FromWorker } from "./host/protocol";
import { routeWorkerMessage } from "./net/host";
import { joinTarget } from "./net/options";
import { registerOffline } from "./pwa";
import { connectWorker } from "./state/store";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

/** Hands an exported save to the browser as a file download. */
function download(info: SaveInfo, file: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([file as BlobPart], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `geonomics-day-${Math.floor(info.gameDay)}.geonomics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Takes the worker's messages that are not for the store: exported saves, and the joined players' traffic. */
function route(message: FromWorker): boolean {
  if (message.type !== "exported") return routeWorkerMessage(message);
  download(message.info, message.file);
  return true;
}

const host = joinTarget();
if (host) void import("./net/client").then((client) => client.connectClient(host));
else connectWorker(new Worker(new URL("./host/sim.worker.ts", import.meta.url), { type: "module" }), route);

registerOffline();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
