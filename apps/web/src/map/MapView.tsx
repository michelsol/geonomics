// The map: a PixiJS canvas driven imperatively from the store, outside React's render cycle.
import { Application } from "pixi.js";
import { useEffect, useRef } from "react";
import { areasNear } from "../state/selectors";
import { BRUSH_REACH_PX, gameStore, useGame } from "../state/store";
import { buildGeometry } from "./geometry";
import { attachInput, type MapPoint } from "./input";
import { MapRenderer } from "./renderer";

/** Screen pixels between the points a brush stroke paints at, at most, so a fast stroke skips no area. */
const STROKE_STEP_PX = 4;

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
        // A brush stroke collects its areas here and reaches the selection only when it ends.
        const painted = new Set<number>();
        let last: MapPoint | null = null;
        const reach = () => BRUSH_REACH_PX[gameStore.getState().brush.size];
        const paintAt = (point: MapPoint) => {
          const area = renderer.pick(point.x, point.y);
          if (area !== null) painted.add(area);
          const px = reach();
          if (px === 0) return;
          const center = renderer.toMap(point.x, point.y);
          const radius = renderer.toMap(point.x + px, point.y).x - center.x;
          for (const near of areasNear(data, center, radius)) painted.add(near);
        };
        const showStroke = (point: MapPoint) => {
          const center = renderer.toMap(point.x, point.y);
          const radius = renderer.toMap(point.x + reach(), point.y).x - center.x;
          renderer.setStroke({ areas: painted, erase: gameStore.getState().brush.erase, at: center, radius });
        };
        const detach = attachInput(app.canvas, renderer, {
          tap(area, _point, additive) {
            gameStore.getState().clickArea(area, additive);
          },
          brushing: () => gameStore.getState().mode.kind === "brush",
          stroke: {
            start(point) {
              painted.clear();
              last = point;
              paintAt(point);
              showStroke(point);
            },
            move(point) {
              const from = last ?? point;
              const step = Math.max(STROKE_STEP_PX, reach() / 2);
              const steps = Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / step);
              for (let i = 1; i <= steps; i++)
                paintAt({ x: from.x + ((point.x - from.x) * i) / steps, y: from.y + ((point.y - from.y) * i) / steps });
              last = point;
              showStroke(point);
            },
            end() {
              renderer.setStroke(null);
              gameStore.getState().paint([...painted]);
              painted.clear();
              last = null;
            },
            cancel() {
              renderer.setStroke(null);
              painted.clear();
              last = null;
            },
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
