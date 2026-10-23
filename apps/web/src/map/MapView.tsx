// The map: a PixiJS canvas driven imperatively from the store, outside React's render cycle.
import { Application } from "pixi.js";
import { useEffect, useRef } from "react";
import { gameStore, useGame } from "../state/store";
import { buildGeometry } from "./geometry";
import { attachInput } from "./input";
import { MapRenderer } from "./renderer";

/** Screen pixels from a lasso's first corner within which a tap closes it. */
const CLOSE_PX = 20;

/** The renderer of the mounted map, for controls outside it (center on area, fit). */
export const mapControls: { renderer: MapRenderer | null } = { renderer: null };

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const data = useGame((state) => state.data);

  useEffect(() => {
    const element = host.current;
    if (!element || !data) return;
    let disposed = false;
    let cleanup = () => {};
    const app = new Application();
    app
      .init({ resizeTo: element, autoStart: false, antialias: true, autoDensity: true, resolution: devicePixelRatio })
      .then(() => {
        if (disposed) {
          app.destroy(true);
          return;
        }
        app.canvas.style.touchAction = "none";
        app.canvas.dataset.testid = "map-canvas";
        element.appendChild(app.canvas);
        const renderer = new MapRenderer(app, data, buildGeometry(data));
        // On phones the panels are a sheet over the bottom of the map: centering keeps areas above it.
        renderer.coveredBottom = () => {
          const sheet = document.querySelector<HTMLElement>(".side");
          if (!sheet || getComputedStyle(sheet).position !== "fixed") return 0;
          return Math.max(0, element.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top);
        };
        mapControls.renderer = renderer;
        const capital = gameStore.getState().selectedArea;
        if (capital !== null) {
          // Open on the player's capital, closer in on larger maps.
          renderer.centerOn(capital);
          const zoom = Math.min(4, Math.max(1.5, Math.sqrt(data.areas.length / 100)));
          const center = renderer.viewCenter();
          renderer.zoomAt(center.x, center.y, zoom);
        }
        renderer.update(gameStore.getState());
        const unsubscribe = gameStore.subscribe((state) => renderer.update(state));
        const detach = attachInput(app.canvas, renderer, {
          tap(area, point, additive) {
            const state = gameStore.getState();
            if (state.mode.kind !== "lasso") {
              state.clickArea(area, additive);
              return;
            }
            // Drawing a selection: a tap on the first corner closes the loop, any other adds a corner.
            const [first] = state.mode.points;
            const start = first && renderer.toScreen(first.x, first.y);
            if (start && state.mode.points.length >= 3 && Math.hypot(start.x - point.x, start.y - point.y) <= CLOSE_PX)
              state.closeLasso();
            else state.addLassoPoint(renderer.toMap(point.x, point.y));
          },
          doubleTap(point) {
            const state = gameStore.getState();
            if (state.mode.kind === "select") state.startLasso(renderer.toMap(point.x, point.y));
          },
        });
        const observer = new ResizeObserver(() => {
          app.resize();
          renderer.resize();
        });
        observer.observe(element);
        cleanup = () => {
          observer.disconnect();
          detach();
          unsubscribe();
          renderer.destroy();
          mapControls.renderer = null;
          app.destroy(true);
        };
      });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [data]);

  return <div ref={host} className="map" />;
}
