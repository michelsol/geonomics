// Draws the map with PixiJS (specification §10, Map). Every layer is cached geometry, redrawn only when what it
// shows changes, and the scene is rendered on demand, so an idle map costs nothing per frame.
import { EDGE_ACTIVE, EDGE_BLOCKED, type Snapshot, type StaticData } from "@geonomics/sim";
import { type Application, Container, FillPattern, Graphics, Matrix, Texture } from "pixi.js";
import {
  largestPopulation,
  priceOf,
  priceSpread,
  realNetIncomes,
  type Spread,
  spreadOf,
  transportFlows,
} from "../state/selectors";
import type { GameState } from "../state/store";
import { ARROW_MIN_SHARE, arrowPolygon, arrowWidth, MAX_ARROWS } from "./arrows";
import {
  AIR_ROUTE,
  ARROW_OUTLINE,
  BLOCKED,
  BORDER,
  CELL_LINE,
  ERASE,
  employmentColor,
  incomeColor,
  MIGRATION_ARROW,
  NEUTRAL,
  PICKED,
  parseColor,
  populationColor,
  RESOURCE_LEVELS,
  resourceLevel,
  SEA_ROUTE,
  SELECTION,
  STRIPE_COLOR,
  STRIPE_TILE,
  STRIPE_WIDTHS,
  satisfactionColor,
  spreadColor,
  TERRAIN_COLORS,
  TRANSPORT_ARROW,
  WATER,
} from "./colors";
import type { MapGeometry } from "./geometry";

const MIN_ZOOM_FACTOR = 0.5; // of the zoom that fits the whole map
const MAX_ZOOM_FACTOR = 40;
const LINE_REDRAW_RATIO = 1.25; // lines keep their screen width within this zoom ratio before being redrawn

interface Drawn {
  cells: unknown[];
  lines: unknown[];
  routes: unknown[];
  flows: unknown[];
  markers: unknown[];
  selection: unknown[];
}

const changed = (previous: unknown[] | undefined, next: unknown[]) =>
  !previous || previous.length !== next.length || previous.some((value, i) => value !== next[i]);

export class MapRenderer {
  private readonly root = new Container();
  private readonly cells = new Graphics();
  private readonly stripes = new Graphics(); // the resources layer's stripes, over the terrain cells
  private stripePatterns: FillPattern[] | null = null;
  private readonly lines = new Graphics();
  private readonly routes = new Graphics();
  private readonly flows = new Graphics();
  private readonly markers = new Graphics();
  private readonly selection = new Graphics();
  private readonly brush = new Graphics();
  private drawn: Partial<Drawn> = {};
  private lineScale = 0;
  private fitScale = 1;
  private frame = 0;
  private state: GameState | null = null;
  /** Screen pixels at the bottom of the map that the panels' bottom sheet covers on phones. */
  coveredBottom: () => number = () => 0;
  private ownerKey = "";
  private largestPopulation = 0;
  private scale: Spread | null = null; // the prices or income layer's lowest, median and highest value
  private incomes: Float32Array | null = null; // the income layer's real net income per area

  constructor(
    private readonly app: Application,
    private readonly data: StaticData,
    private readonly geometry: MapGeometry,
  ) {
    this.root.addChild(
      this.cells,
      this.stripes,
      this.lines,
      this.routes,
      this.flows,
      this.markers,
      this.selection,
      this.brush,
    );
    app.stage.addChild(this.root);
    app.renderer.background.color = WATER;
    this.fit();
  }

  /** Redraws whatever the new state changes, then renders once. */
  update(state: GameState): void {
    this.state = state;
    const { snapshot, layer, priceTable, selectedGood, selectedResource, governments } = state;
    const owners = snapshot ? this.owners(snapshot) : "";
    const cellInputs =
      layer === "realms"
        ? [layer, owners, governments.length]
        : layer === "prices"
          ? [layer, priceTable, selectedGood]
          : layer === "resources"
            ? [layer, selectedResource]
            : layer === "income"
              ? [layer, snapshot, priceTable]
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
    const flowInputs = [state.flows, state.snapshot, state.selectedGood, this.lineScale];
    if (changed(this.drawn.flows, flowInputs)) {
      this.drawFlows(state, px);
      this.drawn.flows = flowInputs;
    }
    const markerInputs = [state.snapshot, state.selectedArmy, this.lineScale];
    if (changed(this.drawn.markers, markerInputs)) {
      this.drawMarkers(state, px);
      this.drawn.markers = markerInputs;
    }
    const selectionInputs = [state.selection, state.peaceAreas, state.mode, this.lineScale];
    if (changed(this.drawn.selection, selectionInputs)) {
      this.drawSelection(state, px);
      this.drawn.selection = selectionInputs;
    }
  }

  private cellColor(state: GameState, area: number): number {
    const { snapshot, data } = { snapshot: state.snapshot, data: this.data };
    switch (state.layer) {
      case "resources": // terrain under the stripes
        return TERRAIN_COLORS[(data.areas[area] as StaticData["areas"][number]).terrain];
      case "realms":
        return this.realmColor(state, area);
      case "population":
        return snapshot ? populationColor(snapshot.areas.population[area] as number, this.largestPopulation) : NEUTRAL;
      case "prices":
        if (!state.priceTable || !this.scale) return NEUTRAL;
        return spreadColor(priceOf(data, state.priceTable, area, state.selectedGood), this.scale);
      case "satisfaction":
        return snapshot ? satisfactionColor(snapshot.areas.necessitySatisfaction[area] as number) : NEUTRAL;
      case "income":
        return this.incomes && this.scale ? incomeColor(this.incomes[area] as number, this.scale) : NEUTRAL;
      case "employment":
        return snapshot ? employmentColor(snapshot.areas.employmentRate[area] as number) : NEUTRAL;
    }
  }

  private realmColor(state: GameState, area: number): number {
    const owner = state.snapshot ? (state.snapshot.areas.owner[area] as number) : -1;
    const color = owner >= 0 ? state.governments[owner]?.color : undefined;
    return color ? parseColor(color) : NEUTRAL;
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
    if (state.layer === "population" && state.snapshot) this.largestPopulation = largestPopulation(state.snapshot);
    // Prices and real net incomes are colored against the map's own lowest, median and highest values.
    this.incomes =
      state.layer === "income" && state.snapshot ? realNetIncomes(this.data, state.snapshot, state.priceTable) : null;
    this.scale =
      state.layer === "prices" && state.priceTable
        ? priceSpread(this.data, state.priceTable, state.selectedGood)
        : this.incomes
          ? spreadOf(this.incomes)
          : null;
    for (let area = 0; area < this.geometry.cells.length; area++) {
      const polygon = this.geometry.cells[area] as number[];
      if (polygon.length < 6) continue;
      g.poly(polygon).fill({ color: this.cellColor(state, area) });
    }
    this.drawStripes(state);
  }

  /** The resources layer: stripes over each area that has the chosen good, thicker for more. */
  private drawStripes(state: GameState): void {
    const g = this.stripes.clear();
    if (state.layer !== "resources") return;
    const patterns = this.patterns();
    const good = state.selectedResource;
    const goods = this.data.goods.length;
    const best = this.bestCapacity(good);
    for (let area = 0; area < this.geometry.cells.length; area++) {
      const polygon = this.geometry.cells[area] as number[];
      const level = resourceLevel(this.data.naturalCapacityMaximum[area * goods + good] as number, best);
      if (level < 0 || polygon.length < 6) continue;
      g.poly(polygon).fill(patterns[level] as FillPattern);
    }
  }

  /** One stripe pattern per level, tiled across the map so that neighbors' stripes line up. */
  private patterns(): FillPattern[] {
    if (this.stripePatterns) return this.stripePatterns;
    // About two and a half stripes across a typical cell, whatever the map's size.
    const cell = Math.sqrt((this.geometry.width * this.geometry.height) / Math.max(this.data.areas.length, 1));
    const transform = new Matrix().scale(cell / 2.5 / STRIPE_TILE, cell / 2.5 / STRIPE_TILE);
    this.stripePatterns = Array.from({ length: RESOURCE_LEVELS }, (_, level) => {
      const canvas = document.createElement("canvas");
      canvas.width = STRIPE_TILE;
      canvas.height = STRIPE_TILE;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.strokeStyle = STRIPE_COLOR;
      context.lineWidth = STRIPE_WIDTHS[level] as number;
      // A diagonal through the tile, and its neighbors' ends in the corners, so tiles join seamlessly.
      for (const offset of [-STRIPE_TILE, 0, STRIPE_TILE]) {
        context.beginPath();
        context.moveTo(offset - 1, STRIPE_TILE + 1);
        context.lineTo(offset + STRIPE_TILE + 1, -1);
        context.stroke();
      }
      const pattern = new FillPattern(Texture.from(canvas), "repeat");
      pattern.setTransform(transform);
      return pattern;
    });
    return this.stripePatterns;
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
    const capacity = state.snapshot?.edges.capacityPerDay;
    // Sea and air routes show only while they run: a port or airport at each end, with staff.
    const open = (id: number) =>
      capacity && state.edges[id]?.mode !== "land" && !((capacity[id] ?? 0) > 0)
        ? 0
        : flags
          ? (flags[id] ?? EDGE_ACTIVE)
          : EDGE_ACTIVE;
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

  /** Flow arrows over the area layer: net migrants per edge, or the goods carried in each direction. */
  private drawFlows(state: GameState, px: number): void {
    const g = this.flows.clear();
    const edges = state.snapshot?.edges;
    if (!edges || state.flows === "none") return;
    const position = (area: number) => this.data.areas[area] as StaticData["areas"][number];
    const candidates: { from: number; to: number; flow: number }[] = [];
    let maximum = 0;
    const add = (from: number, to: number, flow: number) => {
      if (flow <= 0) return;
      candidates.push({ from, to, flow });
      maximum = Math.max(maximum, flow);
    };
    if (state.flows === "migration") {
      for (const [id, edge] of state.edges.entries()) {
        const flow = edges.migration[id] ?? 0;
        if (flow > 0) add(edge.areaA, edge.areaB, flow);
        else if (flow < 0) add(edge.areaB, edge.areaA, -flow);
      }
    } else {
      const { flows } = transportFlows(state);
      if (!flows) return;
      for (const [id, edge] of state.edges.entries()) {
        add(edge.areaA, edge.areaB, flows[2 * id] ?? 0);
        add(edge.areaB, edge.areaA, flows[2 * id + 1] ?? 0);
      }
    }
    const shown = candidates.filter((c) => c.flow >= ARROW_MIN_SHARE * maximum);
    if (shown.length > MAX_ARROWS) shown.sort((a, b) => b.flow - a.flow).length = MAX_ARROWS;
    const sideways = state.flows === "transport"; // both directions of trade can share an edge
    const polygons: number[][] = [];
    const outlines: number[][] = [];
    for (const { from, to, flow } of shown) {
      const a = position(from);
      const b = position(to);
      const width = arrowWidth(flow, maximum) * px;
      const offset = sideways ? width / 2 + px : 0;
      const polygon = arrowPolygon(a.x, a.y, b.x, b.y, width, offset, px);
      if (!polygon) continue;
      polygons.push(polygon);
      outlines.push(arrowPolygon(a.x, a.y, b.x, b.y, width, offset, px, px) as number[]);
    }
    if (polygons.length === 0) return;
    // The outline is a slightly larger dark arrow underneath: fills tessellate far faster than strokes, which matters
    // with thousands of arrows redrawn with every snapshot.
    for (const outline of outlines) g.poly(outline);
    g.fill({ color: ARROW_OUTLINE, alpha: 0.8 });
    for (const polygon of polygons) g.poly(polygon);
    g.fill({ color: state.flows === "migration" ? MIGRATION_ARROW : TRANSPORT_ARROW });
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
    // Several areas are lightly filled; any selection is outlined along its frontier only.
    if (state.selection.length > 1) {
      for (const area of state.selection) {
        const polygon = this.geometry.cells[area];
        if (polygon && polygon.length >= 6) g.poly(polygon).fill({ color: SELECTION, alpha: 0.18 });
      }
    }
    const frontier = this.geometry.outline(state.selection);
    for (let i = 0; i + 3 < frontier.length; i += 4)
      g.moveTo(frontier[i] as number, frontier[i + 1] as number).lineTo(
        frontier[i + 2] as number,
        frontier[i + 3] as number,
      );
    if (frontier.length > 0) g.stroke({ width: 3 * px, color: SELECTION, cap: "round", join: "round" });
    for (const area of state.mode.kind === "pickPeaceAreas" || state.peaceAreas.length > 0 ? state.peaceAreas : []) {
      const polygon = this.geometry.cells[area];
      if (polygon && polygon.length >= 6)
        g.poly(polygon)
          .fill({ color: PICKED, alpha: 0.35 })
          .stroke({ width: 2 * px, color: PICKED });
    }
  }

  /**
   * The brush stroke being painted, before it reaches the selection: its areas filled, white when adding and red when
   * erasing, and a ring of the brush's reach at the pointer. Null clears it.
   */
  setStroke(stroke: { areas: Iterable<number>; erase: boolean; at: { x: number; y: number }; radius: number } | null) {
    const g = this.brush.clear();
    if (stroke) {
      const px = 1 / this.root.scale.x;
      const color = stroke.erase ? ERASE : SELECTION;
      for (const area of stroke.areas) {
        const polygon = this.geometry.cells[area];
        if (polygon && polygon.length >= 6) g.poly(polygon).fill({ color, alpha: 0.4 });
      }
      g.circle(stroke.at.x, stroke.at.y, Math.max(stroke.radius, 6 * px)).stroke({ width: 2 * px, color });
    }
    this.requestRender();
  }

  // Camera

  /** Map units under a screen point. */
  toMap(sx: number, sy: number): { x: number; y: number } {
    const scale = this.root.scale.x;
    return { x: (sx - this.root.position.x) / scale, y: (sy - this.root.position.y) / scale };
  }

  /** The screen point of a map position. */
  toScreen(x: number, y: number): { x: number; y: number } {
    const scale = this.root.scale.x;
    return { x: this.root.position.x + x * scale, y: this.root.position.y + y * scale };
  }

  /** Centers the visible part of the view on a map position without changing the zoom. */
  centerOnPoint(x: number, y: number): void {
    const scale = this.root.scale.x;
    const center = this.viewCenter();
    this.root.position.set(center.x - x * scale, center.y - y * scale);
    this.afterCameraMove();
  }

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

  /** The middle of the part of the map not covered by the bottom sheet, in screen pixels. */
  viewCenter(): { x: number; y: number } {
    const { width, height } = this.app.screen;
    return { x: width / 2, y: (height - Math.min(this.coveredBottom(), 0.8 * height)) / 2 };
  }

  /** Centers the visible part of the view on an area without changing the zoom. */
  centerOn(area: number): void {
    const { x, y } = this.data.areas[area] as StaticData["areas"][number];
    this.centerOnPoint(x, y);
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
    for (const pattern of this.stripePatterns ?? []) pattern.destroy();
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
