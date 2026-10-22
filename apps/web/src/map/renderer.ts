// Draws the map with PixiJS (specification §10, Map). Every layer is cached geometry, redrawn only when what it
// shows changes, and the scene is rendered on demand, so an idle map costs nothing per frame.
import { EDGE_ACTIVE, EDGE_BLOCKED, type Snapshot, type StaticData } from "@geonomics/sim";
import { type Application, Container, Graphics } from "pixi.js";
import { priceOf } from "../state/selectors";
import type { GameState } from "../state/store";
import {
  AIR_ROUTE,
  BLOCKED,
  BORDER,
  CELL_LINE,
  NEUTRAL,
  PICKED,
  parseColor,
  priceColor,
  resourceColor,
  SEA_ROUTE,
  SELECTION,
  satisfactionColor,
  TERRAIN_COLORS,
  WATER,
  wageColor,
} from "./colors";
import type { MapGeometry } from "./geometry";

const MIN_ZOOM_FACTOR = 0.5; // of the zoom that fits the whole map
const MAX_ZOOM_FACTOR = 40;
const LINE_REDRAW_RATIO = 1.25; // lines keep their screen width within this zoom ratio before being redrawn

interface Drawn {
  cells: unknown[];
  lines: unknown[];
  routes: unknown[];
  markers: unknown[];
  selection: unknown[];
}

const changed = (previous: unknown[] | undefined, next: unknown[]) =>
  !previous || previous.length !== next.length || previous.some((value, i) => value !== next[i]);

export class MapRenderer {
  private readonly root = new Container();
  private readonly cells = new Graphics();
  private readonly lines = new Graphics();
  private readonly routes = new Graphics();
  private readonly markers = new Graphics();
  private readonly selection = new Graphics();
  private drawn: Partial<Drawn> = {};
  private lineScale = 0;
  private fitScale = 1;
  private frame = 0;
  private state: GameState | null = null;
  private ownerKey = "";

  constructor(
    private readonly app: Application,
    private readonly data: StaticData,
    private readonly geometry: MapGeometry,
  ) {
    this.root.addChild(this.cells, this.lines, this.routes, this.markers, this.selection);
    app.stage.addChild(this.root);
    app.renderer.background.color = WATER;
    this.fit();
  }

  /** Redraws whatever the new state changes, then renders once. */
  update(state: GameState): void {
    this.state = state;
    const { snapshot, layer, priceTable, selectedGood, governments } = state;
    const owners = snapshot ? this.owners(snapshot) : "";
    const cellInputs =
      layer === "realms"
        ? [layer, owners, governments.length]
        : layer === "prices"
          ? [layer, priceTable, selectedGood]
          : layer === "resources"
            ? [layer, selectedGood]
            : layer === "terrain"
              ? [layer]
              : [layer, snapshot];
    if (changed(this.drawn.cells, cellInputs)) {
      this.drawCells(state);
      this.drawn.cells = cellInputs;
    }
    this.drawOverlays(state);
    this.requestRender();
  }

  private owners(snapshot: Snapshot): string {
    // Owners change rarely; a string key makes the comparison cheap for the realm layer and the borders.
    const owner = snapshot.areas.owner;
    let key = "";
    for (let i = 0; i < owner.length; i++) key += String.fromCharCode((owner[i] as number) + 2);
    this.ownerKey = key;
    return key;
  }

  private drawOverlays(state: GameState): void {
    const scale = this.root.scale.x;
    const zoomed =
      this.lineScale === 0 || scale / this.lineScale > LINE_REDRAW_RATIO || this.lineScale / scale > LINE_REDRAW_RATIO;
    if (zoomed) this.lineScale = scale;
    const px = 1 / this.lineScale; // one screen pixel in map units, at the scale lines were drawn for

    const lineInputs = [this.ownerKey, this.lineScale];
    if (changed(this.drawn.lines, lineInputs)) {
      this.drawLines(state.snapshot, px);
      this.drawn.lines = lineInputs;
    }
    const routeInputs = [state.snapshot?.edges.flags, state.edges.length, this.lineScale];
    if (changed(this.drawn.routes, routeInputs)) {
      this.drawRoutes(state, px);
      this.drawn.routes = routeInputs;
    }
    const markerInputs = [state.snapshot, state.selectedArmy, this.lineScale];
    if (changed(this.drawn.markers, markerInputs)) {
      this.drawMarkers(state, px);
      this.drawn.markers = markerInputs;
    }
    const selectionInputs = [state.selectedArea, state.peaceAreas, state.mode.kind, this.lineScale];
    if (changed(this.drawn.selection, selectionInputs)) {
      this.drawSelection(state, px);
      this.drawn.selection = selectionInputs;
    }
  }

  private cellColor(state: GameState, area: number): number {
    const { snapshot, data } = { snapshot: state.snapshot, data: this.data };
    switch (state.layer) {
      case "terrain":
        return TERRAIN_COLORS[(data.areas[area] as StaticData["areas"][number]).terrain];
      case "realms": {
        const owner = snapshot ? (snapshot.areas.owner[area] as number) : -1;
        const color = owner >= 0 ? state.governments[owner]?.color : undefined;
        return color ? parseColor(color) : NEUTRAL;
      }
      case "prices": {
        if (!state.priceTable) return NEUTRAL;
        const good = data.goods[state.selectedGood];
        if (!good) return NEUTRAL;
        return priceColor(priceOf(data, state.priceTable, area, good.id), good.laborValue);
      }
      case "resources": {
        const goods = data.goods.length;
        const table = data.naturalCapacityMaximum;
        return resourceColor(table[area * goods + state.selectedGood] as number, this.bestCapacity(state.selectedGood));
      }
      case "satisfaction":
        return snapshot ? satisfactionColor(snapshot.areas.necessitySatisfaction[area] as number) : NEUTRAL;
      case "wage":
        return snapshot ? wageColor(snapshot.areas.wageLevel[area] as number) : NEUTRAL;
    }
  }

  private bestCapacities = new Map<number, number>();

  /** The largest natural capacity of a good across the map, cached per good. */
  bestCapacity(good: number): number {
    let best = this.bestCapacities.get(good);
    if (best === undefined) {
      best = 0;
      const goods = this.data.goods.length;
      for (let area = 0; area < this.data.areas.length; area++)
        best = Math.max(best, this.data.naturalCapacityMaximum[area * goods + good] as number);
      this.bestCapacities.set(good, best);
    }
    return best;
  }

  private drawCells(state: GameState): void {
    const g = this.cells.clear();
    for (let area = 0; area < this.geometry.cells.length; area++) {
      const polygon = this.geometry.cells[area] as number[];
      if (polygon.length < 6) continue;
      g.poly(polygon).fill({ color: this.cellColor(state, area) });
    }
  }

  private drawLines(snapshot: Snapshot | null, px: number): void {
    const g = this.lines.clear();
    // Thin lines between all cells, then coasts, then realm borders on top.
    for (const border of this.geometry.borders) {
      if (border.b < 0) continue;
      g.moveTo(border.x1, border.y1).lineTo(border.x2, border.y2);
    }
    g.stroke({ width: 0.75 * px, color: CELL_LINE, alpha: 0.35 });
    for (const border of this.geometry.borders) {
      if (border.b >= 0) continue;
      g.moveTo(border.x1, border.y1).lineTo(border.x2, border.y2);
    }
    g.stroke({ width: 1.5 * px, color: CELL_LINE, alpha: 0.8 });
    if (!snapshot) return;
    const owner = snapshot.areas.owner;
    for (const border of this.geometry.borders) {
      const a = owner[border.a] as number;
      const b = border.b < 0 ? -1 : (owner[border.b] as number);
      if (a === b || (a < 0 && b < 0) || (border.b < 0 && a < 0)) continue;
      g.moveTo(border.x1, border.y1).lineTo(border.x2, border.y2);
    }
    g.stroke({ width: 2 * px, color: BORDER, alpha: 0.85 });
  }

  private drawRoutes(state: GameState, px: number): void {
    const g = this.routes.clear();
    const flags = state.snapshot?.edges.flags;
    const position = (area: number) => this.data.areas[area] as StaticData["areas"][number];
    const open = (id: number) => (flags ? (flags[id] ?? EDGE_ACTIVE) : EDGE_ACTIVE);
    // One pass per style, so each style is a single stroke.
    const styles = [
      { mode: "sea", dash: 8, gap: 8, width: 1, color: SEA_ROUTE },
      { mode: "air", dash: 2, gap: 8, width: 1, color: AIR_ROUTE },
    ] as const;
    for (const style of styles) {
      let any = false;
      for (const [id, edge] of state.edges.entries()) {
        const flag = open(id);
        if (edge.mode !== style.mode || !(flag & EDGE_ACTIVE) || flag & EDGE_BLOCKED) continue;
        const a = position(edge.areaA);
        const b = position(edge.areaB);
        dashed(g, a.x, a.y, b.x, b.y, style.dash * px, style.gap * px);
        any = true;
      }
      if (any) g.stroke({ width: style.width * px, color: style.color, alpha: 0.4 });
    }
    let blocked = false;
    for (const [id, edge] of state.edges.entries()) {
      const flag = open(id);
      if (!(flag & EDGE_ACTIVE) || !(flag & EDGE_BLOCKED)) continue;
      const a = position(edge.areaA);
      const b = position(edge.areaB);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      blocked = true;
    }
    if (blocked) g.stroke({ width: 2.5 * px, color: BLOCKED, alpha: 0.9 });
  }

  private drawMarkers(state: GameState, px: number): void {
    const g = this.markers.clear();
    const snapshot = state.snapshot;
    const position = (area: number) => this.data.areas[area] as StaticData["areas"][number];
    // Sieges: a ring filling up with progress.
    if (snapshot) {
      for (let area = 0; area < snapshot.areas.siegeProgress.length; area++) {
        const progress = snapshot.areas.siegeProgress[area] as number;
        if (progress <= 0) continue;
        const { x, y } = position(area);
        g.circle(x, y, 14 * px).stroke({ width: 3 * px, color: 0x000000, alpha: 0.5 });
        g.moveTo(x, y - 14 * px)
          .arc(x, y, 14 * px, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, progress))
          .stroke({ width: 3 * px, color: BLOCKED });
      }
    }
    for (const government of state.governments) {
      if (government.capital === null || government.isEliminated) continue;
      const { x, y } = position(government.capital);
      g.star(x, y, 5, 9 * px, 4 * px)
        .fill({ color: parseColor(government.color) })
        .stroke({ width: 1.5 * px, color: 0x000000 });
    }
    for (const army of snapshot?.armies ?? []) {
      const at = army.location.kind === "area" ? army.location.area : army.location.from;
      const { x, y } = position(at);
      const color = parseColor(state.governments[army.owner]?.color ?? "#ffffff");
      if (army.path.length > 0) {
        g.moveTo(x, y);
        for (const step of army.path) g.lineTo(position(step).x, position(step).y);
        g.stroke({ width: 2 * px, color, alpha: 0.9 });
      }
      const size = (army.id === state.selectedArmy ? 11 : 8) * px;
      g.poly([x, y - size, x + size, y + 0.8 * size, x - size, y + 0.8 * size])
        .fill({ color })
        .stroke({ width: 1.5 * px, color: army.id === state.selectedArmy ? SELECTION : 0x000000 });
    }
  }

  private drawSelection(state: GameState, px: number): void {
    const g = this.selection.clear();
    if (state.selectedArea !== null) {
      const polygon = this.geometry.cells[state.selectedArea];
      if (polygon && polygon.length >= 6) g.poly(polygon).stroke({ width: 3 * px, color: SELECTION });
    }
    for (const area of state.mode.kind === "pickPeaceAreas" || state.peaceAreas.length > 0 ? state.peaceAreas : []) {
      const polygon = this.geometry.cells[area];
      if (polygon && polygon.length >= 6)
        g.poly(polygon)
          .fill({ color: PICKED, alpha: 0.35 })
          .stroke({ width: 2 * px, color: PICKED });
    }
  }

  // Camera

  /** Fits the whole map in the view. */
  fit(): void {
    const { width, height } = this.app.screen;
    this.fitScale = Math.min(width / this.geometry.width, height / this.geometry.height) * 0.95;
    this.root.scale.set(this.fitScale);
    this.root.position.set(
      (width - this.geometry.width * this.fitScale) / 2,
      (height - this.geometry.height * this.fitScale) / 2,
    );
    this.afterCameraMove();
  }

  /** Centers the view on an area without changing the zoom. */
  centerOn(area: number): void {
    const { x, y } = this.data.areas[area] as StaticData["areas"][number];
    const scale = this.root.scale.x;
    this.root.position.set(this.app.screen.width / 2 - x * scale, this.app.screen.height / 2 - y * scale);
    this.afterCameraMove();
  }

  panBy(dx: number, dy: number): void {
    this.root.position.set(this.root.position.x + dx, this.root.position.y + dy);
    this.afterCameraMove();
  }

  /** Zooms by `factor` keeping the map point under the screen point (sx, sy) in place. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const old = this.root.scale.x;
    const scale = Math.min(this.fitScale * MAX_ZOOM_FACTOR, Math.max(this.fitScale * MIN_ZOOM_FACTOR, old * factor));
    const mx = (sx - this.root.position.x) / old;
    const my = (sy - this.root.position.y) / old;
    this.root.scale.set(scale);
    this.root.position.set(sx - mx * scale, sy - my * scale);
    this.afterCameraMove();
  }

  /** The area under a screen point, or null. */
  pick(sx: number, sy: number): number | null {
    const scale = this.root.scale.x;
    return this.geometry.pick((sx - this.root.position.x) / scale, (sy - this.root.position.y) / scale);
  }

  resize(): void {
    this.requestRender();
  }

  private afterCameraMove(): void {
    if (this.state) this.drawOverlays(this.state);
    this.requestRender();
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.app.render();
    });
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.root.destroy({ children: true });
  }
}

/** Adds a dashed line to the current path of a Graphics. */
function dashed(g: Graphics, x1: number, y1: number, x2: number, y2: number, dash: number, gap: number): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length === 0) return;
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  for (let d = 0; d < length; d += dash + gap) {
    const end = Math.min(length, d + dash);
    g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * end, y1 + uy * end);
  }
}
