// The map: a three.js globe driven imperatively from the store, outside React's render cycle.
import { chord } from "@geonomics/sim";
import { useEffect, useRef } from "react";
import { areasNear } from "../state/selectors";
import { BRUSH_REACH_PX, gameStore, useGame } from "../state/store";
import { attachInput, type MapPoint } from "./input";
import { GlobeRenderer } from "./renderer";

/** Screen pixels between the points a brush stroke paints at, at most, so a fast stroke skips no area. */
const STROKE_STEP_PX = 4;

/** The renderer of the mounted map, for controls outside it (center on area). */
export const mapControls: { renderer: GlobeRenderer | null } = { renderer: null };

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const data = useGame((state) => state.data);

  useEffect(() => {
    const element = host.current;
    if (!element || !data) return;
    const renderer = new GlobeRenderer(element, data);
    // On phones the panels are a sheet over the bottom of the map: centering keeps areas above it.
    renderer.coveredBottom = () => {
      const sheet = document.querySelector<HTMLElement>(".side");
      if (!sheet || getComputedStyle(sheet).position !== "fixed") return 0;
      return Math.max(0, element.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top);
    };
    mapControls.renderer = renderer;
    // Open on the player's capital, close enough to tell its areas apart; a spectator sees the whole globe.
    const capital = gameStore.getState().selectedArea;
    if (capital !== null) renderer.focus(capital);
    renderer.update(gameStore.getState());
    const unsubscribe = gameStore.subscribe((state) => renderer.update(state));
    // A brush stroke collects its areas here and reaches the selection only when it ends.
    const painted = new Set<number>();
    let last: MapPoint | null = null;
    const reach = () => BRUSH_REACH_PX[gameStore.getState().brush.size];
    /** The brush's reach around a screen point, in km over the globe, or null off the globe. */
    const brushAt = (point: MapPoint) => {
      const center = renderer.toMap(point.x, point.y);
      if (!center) return null;
      const edge = renderer.toMap(point.x + Math.max(reach(), 1), point.y);
      return { center, radius: edge ? chord(center, edge) * (reach() > 0 ? 1 : 0) : 0 };
    };
    const paintAt = (point: MapPoint) => {
      const area = renderer.pick(point.x, point.y);
      if (area !== null) painted.add(area);
      const at = brushAt(point);
      if (!at || at.radius === 0) return;
      for (const near of areasNear(data, at.center, at.radius)) painted.add(near);
    };
    const showStroke = (point: MapPoint) => {
      const at = brushAt(point);
      if (!at) return;
      renderer.setStroke({ areas: painted, erase: gameStore.getState().brush.erase, at: at.center, radius: at.radius });
    };
    const detach = attachInput(renderer.canvas, renderer, {
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
    const observer = new ResizeObserver(() => renderer.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      detach();
      unsubscribe();
      renderer.destroy();
      mapControls.renderer = null;
    };
  }, [data]);

  return <div ref={host} className="map" />;
}
