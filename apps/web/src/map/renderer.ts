// Draws the map as a globe with three.js (specification §9, Map). Every layer is cached geometry, redrawn only when what
// it shows changes, and the scene is rendered on demand, so an idle map costs nothing per frame. Rotating and zooming
// move the globe and the camera only; lines and marks sized in pixels are rebuilt when the zoom has moved enough.
import { EDGE_ACTIVE, EDGE_BLOCKED, type Point3, type Snapshot, type StaticData, shores } from "@geonomics/sim";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  type GroupFlow,
  largestPopulation,
  type Point,
  priceOf,
  priceSpread,
  reachOf,
  realmFlows,
  realNetIncomes,
  type Spread,
  spreadOf,
  transportFlows,
  waterCapacityMaximum,
} from "../state/selectors";
import type { GameState } from "../state/store";
import { ARROW_MIN_SHARE, arrowWidth, MAX_ARROWS, realmArrowWidth } from "./arrows";
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
  mix,
  NEUTRAL,
  OUTSIDE,
  PICKED,
  parseColor,
  populationColor,
  resourceLevel,
  SEA_ROUTE,
  SELECTION,
  STRIPE_TILE,
  STRIPE_WIDTHS,
  satisfactionColor,
  spreadColor,
  TERRAIN_COLORS,
  TRANSPORT_ARROW,
  waterColor,
} from "./colors";
import { buildGlobe, type GlobeGeometry } from "./globe";
import { cellSpacing, realmLabels } from "./labels";
import { waterPath } from "./seaPaths";
import { arc, arrowTriangles, lift, placeShape } from "./surface";

const FIELD_OF_VIEW = 30; // degrees, vertical
const LINE_REDRAW_RATIO = 1.25; // marks keep their screen size within this zoom ratio before being redrawn
/** Closest and farthest camera, as altitude over the radius. */
const MIN_ALTITUDE = 0.04;
const MAX_ALTITUDE = 6;
/** The map opens on the player's capital with a cell about this many pixels wide. */
const OPENING_CELL_PX = 40;
/** Realm names stay within these heights on screen, and hide below. */
const LABEL_MIN_PX = 10;
const LABEL_MAX_PX = 34;
/** Stripes of the resources layer: one every this many screen pixels, widths as in the 2D stripe tile. */
const STRIPE_PERIOD_PX = 14;
/** Heights of the overlays over the cells, as a share of the radius: lines, routes, arrows, marks, names. */
const LIFT = { fill: 1.0006, lines: 1.0015, routes: 1.002, arrows: 1.003, marks: 1.004, labels: 1.01 };

interface Drawn {
  cells: unknown[];
  lines: unknown[];
  routes: unknown[];
  flows: unknown[];
  markers: unknown[];
  labels: unknown[];
  selection: unknown[];
}

const changed = (previous: unknown[] | undefined, next: unknown[]) =>
  !previous || previous.length !== next.length || previous.some((value, i) => value !== next[i]);

/** A brush stroke being painted: its areas, and a ring of the brush's reach, in km, around the pointer. */
export interface Stroke {
  areas: Iterable<number>;
  erase: boolean;
  at: Point3;
  radius: number;
}

export class GlobeRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly labelRenderer = new CSS2DRenderer();
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 10);
  private readonly globe = new Group(); // everything on the sphere, rotated as one
  private readonly geometry: GlobeGeometry;
  private readonly radius: number;
  private readonly positions: BufferAttribute;
  private readonly cellColors: Float32Array;
  private readonly cells: Mesh;
  private readonly stripes: Mesh;
  private readonly stripeLevels: Float32Array;
  private readonly layers = {
    lines: new Group(),
    routes: new Group(),
    flows: new Group(),
    markers: new Group(),
    labels: new Group(),
    selection: new Group(),
    brush: new Group(),
  };
  private readonly lineMaterials = new Set<LineMaterial>();
  /** Materials by style, kept across redraws: a freed material frees its shader, which would be compiled again. */
  private readonly materials = new Map<string, Material>();
  private altitude: number; // camera height over the surface, in km
  private drawn: Partial<Drawn> = {};
  private px = 0; // one screen pixel in km, as the overlays were last drawn for
  private frame = 0;
  private state: GameState | null = null;
  private width = 1;
  private height = 1;
  /** Screen pixels at the bottom of the map that the panels' bottom sheet covers on phones. */
  coveredBottom: () => number = () => 0;
  private ownerKey = "";
  private portKey = "";
  private largestPopulation = 0;
  private scale: Spread | null = null;
  private incomes: Float32Array | null = null;
  private shore: number[][] | null = null;
  private readonly routePaths = new Map<number, Point3[]>();
  private readonly bestCapacities = new Map<number, number>();
  private labelObjects: CSS2DObject[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly data: StaticData,
  ) {
    this.geometry = buildGlobe(data);
    this.radius = this.geometry.radius;
    // Smoothing edges costs little on a graphics card but halves the frame rate where WebGL runs in software.
    this.renderer = new WebGLRenderer({ antialias: !softwareRendering() });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(OUTSIDE);
    this.canvas = this.renderer.domElement;
    this.canvas.style.touchAction = "none";
    this.canvas.style.display = "block";
    this.canvas.dataset.testid = "map-canvas";
    host.appendChild(this.canvas);
    const labels = this.labelRenderer.domElement;
    labels.style.position = "absolute";
    labels.style.inset = "0";
    labels.style.pointerEvents = "none";
    host.appendChild(labels);

    // The cells: one mesh of triangle fans, colored per vertex.
    const shape = new BufferGeometry();
    this.positions = new BufferAttribute(this.geometry.positions, 3);
    shape.setAttribute("position", this.positions);
    this.cellColors = new Float32Array(this.geometry.positions.length);
    shape.setAttribute("color", new BufferAttribute(this.cellColors, 3));
    shape.setIndex(new BufferAttribute(this.geometry.triangles, 1));
    this.cells = new Mesh(shape, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
    // The resources layer's stripes, over the same triangles.
    const stripes = new BufferGeometry();
    stripes.setAttribute("position", this.positions);
    this.stripeLevels = new Float32Array(this.geometry.positions.length / 3).fill(-1);
    stripes.setAttribute("level", new BufferAttribute(this.stripeLevels, 1));
    stripes.setIndex(new BufferAttribute(this.geometry.triangles, 1));
    this.stripes = new Mesh(stripes, stripeMaterial());
    this.stripes.scale.setScalar(LIFT.fill);
    this.stripes.renderOrder = 1;
    this.globe.add(this.cells, this.stripes, ...Object.values(this.layers));
    this.scene.add(this.globe);
    this.altitude = this.wholeGlobeAltitude();
    this.resize();
  }

  /** Redraws whatever the new state changes, then renders once. */
  update(state: GameState): void {
    this.state = state;
    const { snapshot, layer, priceTable, selectedGood, selectedResource, governments } = state;
    const owners = snapshot ? this.owners(snapshot) : "";
    if (snapshot) this.portKey = String.fromCharCode(...snapshot.areas.portLevel);
    const cellInputs =
      layer === "realms"
        ? [layer, owners, this.portKey, governments.length]
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
    const now = this.kmPerPixel();
    if (this.px === 0 || now / this.px > LINE_REDRAW_RATIO || this.px / now > LINE_REDRAW_RATIO) this.px = now;
    const px = this.px;
    const lineInputs = [this.ownerKey, px];
    if (changed(this.drawn.lines, lineInputs)) {
      this.drawLines(state.snapshot);
      this.drawn.lines = lineInputs;
    }
    const routeInputs = [this.routeKey(state), state.edges.length, px];
    if (changed(this.drawn.routes, routeInputs)) {
      this.drawRoutes(state, px);
      this.drawn.routes = routeInputs;
    }
    const flowInputs = [
      state.flows,
      state.snapshot,
      state.selectedGood,
      state.flowsBetweenRealms,
      state.governments,
      px,
    ];
    if (changed(this.drawn.flows, flowInputs)) {
      this.drawFlows(state, px);
      this.drawn.flows = flowInputs;
    }
    const markerInputs = [state.snapshot, state.selection, px];
    if (changed(this.drawn.markers, markerInputs)) {
      this.drawMarkers(state, px);
      this.drawn.markers = markerInputs;
    }
    const labelInputs = [this.ownerKey, state.governments];
    if (changed(this.drawn.labels, labelInputs)) {
      this.drawLabels(state);
      this.drawn.labels = labelInputs;
    }
    const selectionInputs = [state.selection, state.peaceAreas, state.mode, this.portKey, px];
    if (changed(this.drawn.selection, selectionInputs)) {
      this.drawSelection(state);
      this.drawn.selection = selectionInputs;
    }
  }

  // Cells

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

  /** The largest natural capacity of a good in one cell across the map, land or water, cached per good. */
  bestCapacity(good: number): number {
    let best = this.bestCapacities.get(good);
    if (best === undefined) {
      best = 0;
      const goods = this.data.goods.length;
      for (let area = 0; area < this.data.areas.length; area++)
        best = Math.max(best, this.data.naturalCapacityMaximum[area * goods + good] as number);
      for (let water = 0; water < this.data.waters.length; water++)
        best = Math.max(best, waterCapacityMaximum(this.data, water, good));
      this.bestCapacities.set(good, best);
    }
    return best;
  }

  /**
   * Water cells by depth; on the realms layer, the cells a realm's ports reach take a tint of its color, and cells
   * shared between realms a pale one.
   */
  private waterColors(state: GameState): number[] {
    const reach = state.layer === "realms" ? reachOf(this.data, state.snapshot) : null;
    const owner = state.snapshot?.areas.owner;
    // Per water cell: the realm reaching it, -1 for none, -2 for several.
    const realm = new Int32Array(this.data.waters.length).fill(-1);
    if (reach && owner) {
      for (const [area, cells] of reach.entries()) {
        const by = owner[area] as number;
        if (by < 0) continue;
        for (const { water } of cells) realm[water] = realm[water] === -1 || realm[water] === by ? by : -2;
      }
    }
    return this.data.waters.map((water, id) => {
      let color = waterColor(water.depth);
      const by = realm[id] as number;
      if (by === -2) color = mix(color, NEUTRAL, 0.45);
      else if (by >= 0) {
        const realmColor = state.governments[by]?.color;
        if (realmColor) color = mix(color, parseColor(realmColor), 0.35);
      }
      return color;
    });
  }

  private drawCells(state: GameState): void {
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
    const { areaCount, cellCount, firstVertex, vertexCount } = this.geometry;
    const waters = this.waterColors(state);
    const color = new Color();
    for (let cell = 0; cell < cellCount; cell++) {
      color.setHex(cell < areaCount ? this.cellColor(state, cell) : (waters[cell - areaCount] as number));
      const first = firstVertex[cell] as number;
      for (let v = first; v < first + (vertexCount[cell] as number); v++)
        this.cellColors.set([color.r, color.g, color.b], 3 * v);
    }
    (this.cells.geometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
    this.drawStripes(state);
  }

  /** The resources layer: stripes over each area or water cell that has the chosen good, thicker for more. */
  private drawStripes(state: GameState): void {
    this.stripes.visible = state.layer === "resources";
    if (!this.stripes.visible) return;
    const good = state.selectedResource;
    const goods = this.data.goods.length;
    const best = this.bestCapacity(good);
    const { areaCount, cellCount, firstVertex, vertexCount } = this.geometry;
    for (let cell = 0; cell < cellCount; cell++) {
      const capacity =
        cell < areaCount
          ? (this.data.naturalCapacityMaximum[cell * goods + good] as number)
          : waterCapacityMaximum(this.data, cell - areaCount, good);
      const first = firstVertex[cell] as number;
      this.stripeLevels.fill(resourceLevel(capacity, best), first, first + (vertexCount[cell] as number));
    }
    (this.stripes.geometry.getAttribute("level") as BufferAttribute).needsUpdate = true;
  }

  // Overlays

  /** Thin lines between all cells, then coasts, then realm borders on top. */
  private drawLines(snapshot: Snapshot | null): void {
    const group = this.clear(this.layers.lines);
    const inner: number[] = [];
    const coasts: number[] = [];
    const realms: number[] = [];
    const owner = snapshot?.areas.owner;
    for (const { a, b, p, q } of this.geometry.borders) {
      (b < 0 ? coasts : inner).push(p.x, p.y, p.z, q.x, q.y, q.z);
      if (!owner) continue;
      const oa = owner[a] as number;
      const ob = b < 0 ? -1 : (owner[b] as number);
      if (oa === ob || (oa < 0 && ob < 0) || (b < 0 && oa < 0)) continue;
      realms.push(p.x, p.y, p.z, q.x, q.y, q.z);
    }
    // Thousands of thin lines between cells: plain one-pixel lines, far cheaper to draw than wide ones.
    if (inner.length > 0) group.add(this.thinLines(inner, CELL_LINE, 0.3));
    if (coasts.length > 0) group.add(this.lines(coasts, { width: 1.5, color: CELL_LINE, opacity: 0.8 }));
    if (realms.length > 0) group.add(this.lines(realms, { width: 2, color: BORDER, opacity: 0.85 }));
    group.scale.setScalar(LIFT.lines);
  }

  private drawRoutes(state: GameState, px: number): void {
    const group = this.clear(this.layers.routes);
    const flags = state.snapshot?.edges.flags;
    const capacity = state.snapshot?.edges.capacityPerDay;
    // Sea and air routes show only while they run: a port or airport at each end, with staff.
    const open = (id: number) =>
      capacity && state.edges[id]?.mode !== "land" && !((capacity[id] ?? 0) > 0)
        ? 0
        : flags
          ? (flags[id] ?? EDGE_ACTIVE)
          : EDGE_ACTIVE;
    const styles = [
      { mode: "sea", dash: 8, gap: 8, color: SEA_ROUTE },
      { mode: "air", dash: 2, gap: 8, color: AIR_ROUTE },
    ] as const;
    for (const style of styles) {
      const segments: number[] = [];
      for (const [id, edge] of state.edges.entries()) {
        const flag = open(id);
        if (edge.mode !== style.mode || !(flag & EDGE_ACTIVE) || flag & EDGE_BLOCKED) continue;
        pushPath(segments, this.routePath(id));
      }
      if (segments.length > 0) group.add(this.dashedLines(segments, style.color, 0.6, style.dash * px, style.gap * px));
    }
    const blocked: number[] = [];
    for (const [id] of state.edges.entries()) {
      const flag = open(id);
      if (flag & EDGE_ACTIVE && flag & EDGE_BLOCKED) pushPath(blocked, this.routePath(id));
    }
    if (blocked.length > 0) group.add(this.lines(blocked, { width: 2.5, color: BLOCKED, opacity: 0.9 }));
    group.scale.setScalar(LIFT.routes);
  }

  /**
   * What the routes layer shows, as a string: each edge's flags and whether it carries anything. Snapshots bring new
   * arrays every tick, but routes open, close or get blocked rarely.
   */
  private routeKey(state: GameState): string {
    const flags = state.snapshot?.edges.flags;
    const capacity = state.snapshot?.edges.capacityPerDay;
    if (!flags) return "";
    let key = "";
    for (let id = 0; id < flags.length; id++)
      key += String.fromCharCode(65 + (flags[id] as number) * 2 + ((capacity?.[id] ?? 0) > 0 ? 1 : 0));
    return key;
  }

  /**
   * The line a route is drawn along, on the sphere: for a sea route the shortest way over water, computed the first
   * time it shows (edge ids are stable); otherwise, or with no water path, the great circle between the area centers.
   */
  private routePath(id: number): Point3[] {
    const cached = this.routePaths.get(id);
    if (cached) return cached;
    const edge = this.state?.edges[id] ?? this.data.edges[id];
    if (!edge) return [];
    const a = this.data.areas[edge.areaA] as StaticData["areas"][number];
    const b = this.data.areas[edge.areaB] as StaticData["areas"][number];
    const step = cellSpacing(this.data) / 4;
    let path: Point3[] | null = null;
    if (edge.mode === "sea") {
      this.shore ??= shores(this.data.waters, this.data.areas.length);
      const flat = waterPath(this.data, this.shore, edge.areaA, edge.areaB);
      if (flat) {
        path = [];
        for (let i = 0; i + 5 < flat.length; i += 3) {
          const p = { x: flat[i] as number, y: flat[i + 1] as number, z: flat[i + 2] as number };
          const q = { x: flat[i + 3] as number, y: flat[i + 4] as number, z: flat[i + 5] as number };
          const leg = arc(p, q, this.radius, step);
          path.push(...(path.length > 0 ? leg.slice(1) : leg));
        }
      }
    }
    path ??= arc(a, b, this.radius, step);
    this.routePaths.set(id, path);
    return path;
  }

  /** Realm names as HTML labels over the globe; their size and side are set at each render (renderLabels). */
  private drawLabels(state: GameState): void {
    const group = this.clear(this.layers.labels);
    this.labelObjects = [];
    if (!state.snapshot) return;
    for (const label of realmLabels(this.data, state.snapshot, state.governments)) {
      const element = document.createElement("div");
      element.className = "realm-label";
      element.textContent = label.text;
      const object = new CSS2DObject(element);
      const at = lift(label.at, this.radius * LIFT.labels);
      object.position.set(at.x, at.y, at.z);
      object.userData.size = label.size;
      group.add(object);
      this.labelObjects.push(object);
    }
  }

  /** Shows each name at its size for the current zoom, and hides those too small or on the far side of the globe. */
  private renderLabels(): void {
    const px = this.kmPerPixel();
    const world = new Vector3();
    const toCamera = new Vector3();
    for (const object of this.labelObjects) {
      const screen = (object.userData.size as number) / px;
      object.getWorldPosition(world);
      toCamera.copy(this.camera.position).sub(world).normalize();
      const facing = world.normalize().dot(toCamera);
      object.visible = screen >= LABEL_MIN_PX && facing > 0.15;
      object.element.style.fontSize = `${Math.min(screen, LABEL_MAX_PX).toFixed(1)}px`;
    }
  }

  /**
   * Flow arrows over the area layer: net migrants per edge, or the goods carried in each direction; or, between realms
   * only, the same summed across each border, capital to capital. They follow the great circles between areas.
   */
  private drawFlows(state: GameState, px: number): void {
    const group = this.clear(this.layers.flows);
    const snapshot = state.snapshot;
    const edges = snapshot?.edges;
    if (!snapshot || !edges || state.flows === "none") return;
    const position = (area: number) => this.data.areas[area] as StaticData["areas"][number];
    const candidates: GroupFlow[] = [];
    let maximum = 0;
    const add = (from: Point, to: Point, flow: number) => {
      if (flow <= 0) return;
      candidates.push({ from, to, flow });
      maximum = Math.max(maximum, flow);
    };
    if (state.flowsBetweenRealms) {
      for (const f of realmFlows(this.data, snapshot, state.edges, state.governments, state.flows))
        add(f.from, f.to, f.flow);
    } else if (state.flows === "migration") {
      for (const [id, edge] of state.edges.entries()) {
        const flow = edges.migration[id] ?? 0;
        if (flow > 0) add(position(edge.areaA), position(edge.areaB), flow);
        else if (flow < 0) add(position(edge.areaB), position(edge.areaA), -flow);
      }
    } else {
      const { flows } = transportFlows(state);
      if (!flows) return;
      for (const [id, edge] of state.edges.entries()) {
        add(position(edge.areaA), position(edge.areaB), flows[2 * id] ?? 0);
        add(position(edge.areaB), position(edge.areaA), flows[2 * id + 1] ?? 0);
      }
    }
    const shown = candidates.filter((c) => c.flow >= ARROW_MIN_SHARE * maximum);
    if (shown.length > MAX_ARROWS) shown.sort((a, b) => b.flow - a.flow).length = MAX_ARROWS;
    const sideways = state.flows === "transport"; // both directions of trade can share an edge
    const widthOf = state.flowsBetweenRealms ? realmArrowWidth : arrowWidth;
    const radius = this.radius * LIFT.arrows;
    const fills: number[] = [];
    const outlines: number[] = [];
    for (const { from, to, flow } of shown) {
      const width = widthOf(flow, maximum) * px;
      const offset = sideways ? width / 2 + px : 0;
      const arrow = arrowTriangles(from, to, width, offset, px, radius);
      if (!arrow) continue;
      fills.push(...arrow);
      outlines.push(...(arrowTriangles(from, to, width, offset, px, radius, px) as number[]));
    }
    if (fills.length === 0) return;
    // The outline is a slightly larger dark arrow underneath: fills draw far faster than wide lines.
    group.add(
      this.triangles(outlines, ARROW_OUTLINE, 0.8, 2),
      this.triangles(fills, state.flows === "migration" ? MIGRATION_ARROW : TRANSPORT_ARROW, 1, 3),
    );
  }

  private drawMarkers(state: GameState, px: number): void {
    const group = this.clear(this.layers.markers);
    const snapshot = state.snapshot;
    const radius = this.radius * LIFT.marks;
    const position = (area: number) => this.data.areas[area] as StaticData["areas"][number];
    const fills: { points: number[]; colors: number[] } = { points: [], colors: [] };
    const outlines: number[] = [];
    const color = new Color();
    const fill = (triangles: Point3[], hex: number) => {
      color.setHex(hex);
      for (const p of triangles) {
        fills.points.push(p.x, p.y, p.z);
        fills.colors.push(color.r, color.g, color.b);
      }
    };
    const outline = (triangles: Point3[]) => {
      for (const p of triangles) outlines.push(p.x, p.y, p.z);
    };
    const shape = (at: Point3, flat: number[]) =>
      fan(placeShape(at, flat, px, radius), placeShape(at, [0, 0], px, radius)[0] as Point3);
    // Sieges: a ring filling up with progress.
    if (snapshot) {
      for (let area = 0; area < snapshot.areas.siegeProgress.length; area++) {
        const progress = snapshot.areas.siegeProgress[area] as number;
        if (progress <= 0) continue;
        const at = position(area);
        fill(strip(placeShape(at, ring(14, 3, 1), px, radius)), 0x333333);
        fill(strip(placeShape(at, ring(14, 3, Math.min(1, progress)), px, radius)), BLOCKED);
      }
    }
    for (const government of state.governments) {
      if (government.capital === null || government.isEliminated) continue;
      const at = position(government.capital);
      outline(shape(at, star(10.5, 5)));
      fill(shape(at, star(9, 4)), parseColor(government.color));
    }
    const paths: number[] = [];
    const pathColors: number[] = [];
    // The player's soldiers in the selection, which the Armies panel moves, stand out.
    const selected = new Set(state.selection);
    const me = snapshot?.government?.id;
    for (const army of snapshot?.armies ?? []) {
      const from = army.location.kind === "area" ? army.location.area : army.location.from;
      const chosen = army.owner === me && selected.has(from);
      const at = position(from);
      const hex = parseColor(state.governments[army.owner]?.color ?? "#ffffff");
      color.setHex(hex);
      let previous: Point3 = at;
      for (const step of army.path) {
        const leg = arc(previous, position(step), radius, cellSpacing(this.data) / 4);
        for (let i = 0; i + 1 < leg.length; i++) {
          const p = leg[i] as Point3;
          const q = leg[i + 1] as Point3;
          paths.push(p.x, p.y, p.z, q.x, q.y, q.z);
          pathColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
        previous = position(step);
      }
      const size = chosen ? 11 : 8;
      const triangle = [0, -size, size, 0.8 * size, -size, 0.8 * size];
      const grown = [0, -size - 2.5, size + 2.2, 0.8 * size + 1.5, -size - 2.2, 0.8 * size + 1.5];
      if (chosen) fill(placeShape(at, grown, px, radius), SELECTION);
      else outline(placeShape(at, grown, px, radius));
      fill(placeShape(at, triangle, px, radius), hex);
    }
    if (paths.length > 0) group.add(this.lines(paths, { width: 2, color: 0xffffff, opacity: 0.9, colors: pathColors }));
    if (outlines.length > 0) group.add(this.triangles(outlines, 0x000000, 1, 4));
    if (fills.points.length > 0) group.add(this.triangles(fills.points, 0xffffff, 1, 5, fills.colors));
  }

  private drawSelection(state: GameState): void {
    const group = this.clear(this.layers.selection);
    // Several areas are lightly filled; any selection is outlined along its frontier only.
    if (state.selection.length > 1) group.add(this.cellFill(state.selection, SELECTION, 0.18));
    // The water cells the selected areas' ports reach.
    const reach = reachOf(this.data, state.snapshot);
    if (reach) {
      const waters = new Set(state.selection.flatMap((area) => (reach[area] ?? []).map((cell) => cell.water)));
      if (waters.size > 0)
        group.add(
          this.cellFill(
            [...waters].map((water) => this.geometry.areaCount + water),
            SELECTION,
            0.14,
          ),
        );
    }
    const frontier = this.geometry.outline(state.selection);
    if (frontier.length > 0)
      group.add(this.lines(frontier, { width: 3, color: SELECTION, opacity: 1, lift: LIFT.lines }));
    const peace = state.mode.kind === "pickPeaceAreas" || state.peaceAreas.length > 0 ? state.peaceAreas : [];
    if (peace.length > 0) {
      group.add(this.cellFill(peace, PICKED, 0.35));
      group.add(this.lines(this.geometry.outline(peace), { width: 2, color: PICKED, opacity: 1, lift: LIFT.lines }));
    }
  }

  /**
   * The brush stroke being painted, before it reaches the selection: its areas filled, white when adding and red when
   * erasing, and a ring of the brush's reach at the pointer. Null clears it.
   */
  setStroke(stroke: Stroke | null): void {
    const group = this.clear(this.layers.brush);
    if (stroke) {
      const color = stroke.erase ? ERASE : SELECTION;
      group.add(this.cellFill(stroke.areas, color, 0.4));
      const px = this.kmPerPixel();
      const reach = Math.max(stroke.radius, 6 * px) / px; // in pixels, for placeShape
      const circle = placeShape(stroke.at, loop(reach), px, this.radius * LIFT.marks);
      const segments: number[] = [];
      for (let i = 0; i < circle.length; i++) {
        const p = circle[i] as Point3;
        const q = circle[(i + 1) % circle.length] as Point3;
        segments.push(p.x, p.y, p.z, q.x, q.y, q.z);
      }
      group.add(this.lines(segments, { width: 2, color, opacity: 1 }));
    }
    this.requestRender();
  }

  // Building blocks

  /** Removes what a layer held and frees its geometry; materials stay for the next drawing. */
  private clear(group: Group): Group {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeGeometry(child);
    }
    group.scale.setScalar(1);
    return group;
  }

  /** The material of a style, made the first time it is asked for. */
  private material<T extends Material>(key: string, make: () => T): T {
    let material = this.materials.get(key) as T | undefined;
    if (!material) {
      material = make();
      this.materials.set(key, material);
      if (material instanceof LineMaterial) {
        material.resolution.set(this.width, this.height);
        this.lineMaterials.add(material);
      }
    }
    return material;
  }

  private lines(
    segments: number[],
    style: {
      width: number;
      color: number;
      opacity: number;
      dash?: number;
      gap?: number;
      colors?: number[];
      lift?: number;
    },
  ): LineSegments2 {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(segments);
    if (style.colors) geometry.setColors(style.colors);
    const key = `wide ${style.width} ${style.color} ${style.opacity} ${Boolean(style.colors)} ${style.dash !== undefined}`;
    const material = this.material(
      key,
      () =>
        new LineMaterial({
          color: style.colors ? 0xffffff : style.color,
          linewidth: style.width,
          transparent: true,
          opacity: style.opacity,
          depthWrite: false,
          vertexColors: Boolean(style.colors),
          dashed: style.dash !== undefined,
        }),
    );
    material.dashSize = style.dash ?? 1;
    material.gapSize = style.gap ?? 1;
    const line = new LineSegments2(geometry, material);
    if (style.dash !== undefined) line.computeLineDistances();
    if (style.lift) line.scale.setScalar(style.lift);
    line.renderOrder = 2;
    return line;
  }

  private triangles(points: number[], color: number, opacity: number, order: number, colors?: number[]): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
    if (colors) geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const material = this.material(
      `triangles ${color} ${opacity} ${Boolean(colors)}`,
      () =>
        new MeshBasicMaterial({
          color,
          vertexColors: Boolean(colors),
          transparent: true, // drawn with the other overlays, in their render order
          opacity,
          side: DoubleSide,
          depthWrite: false,
        }),
    );
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = order;
    return mesh;
  }

  /** One-pixel lines between pairs of points (x1, y1, z1, x2, y2, z2 each): far cheaper to draw than wide ones. */
  private thinLines(segments: number[], color: number, opacity: number): LineSegments {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(segments, 3));
    const material = this.material(
      `thin ${color} ${opacity}`,
      () => new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    );
    const lines = new LineSegments(geometry, material);
    lines.renderOrder = 2;
    return lines;
  }

  /** One-pixel dashed lines between pairs of points, dashes and gaps in km: routes are thin, and many. */
  private dashedLines(segments: number[], color: number, opacity: number, dash: number, gap: number): LineSegments {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(segments, 3));
    const material = this.material(
      `dashed ${color} ${opacity}`,
      () => new LineDashedMaterial({ color, transparent: true, opacity, depthWrite: false }),
    );
    material.dashSize = dash;
    material.gapSize = gap;
    const lines = new LineSegments(geometry, material);
    lines.computeLineDistances();
    lines.renderOrder = 2;
    return lines;
  }

  /** A fill over some cells (areas, or areaCount + water for water cells), just above the cells. */
  private cellFill(cells: Iterable<number>, color: number, opacity: number): Mesh {
    const indices = this.geometry.trianglesOf(cells);
    const points = new Float32Array(3 * indices.length);
    for (const [k, vertex] of indices.entries())
      points.set(this.geometry.positions.subarray(3 * vertex, 3 * vertex + 3), 3 * k);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(points, 3));
    const material = this.material(
      `fill ${color} ${opacity}`,
      () => new MeshBasicMaterial({ color, transparent: true, opacity, side: DoubleSide, depthWrite: false }),
    );
    const mesh = new Mesh(geometry, material);
    mesh.scale.setScalar(LIFT.fill);
    mesh.renderOrder = 1;
    return mesh;
  }

  // Camera

  /** One screen pixel in km at the point of the globe facing the camera. */
  private kmPerPixel(): number {
    const covered = this.covered();
    return (2 * this.altitude * Math.tan((FIELD_OF_VIEW * Math.PI) / 360)) / (this.height + covered);
  }

  private covered(): number {
    return Math.min(this.coveredBottom(), 0.8 * this.height);
  }

  /** The camera's altitude at which the whole globe fits in the view. */
  private wholeGlobeAltitude(): number {
    const distance = this.radius / Math.sin(0.45 * ((FIELD_OF_VIEW * Math.PI) / 180));
    return Math.min(MAX_ALTITUDE * this.radius, distance - this.radius);
  }

  private placeCamera(): void {
    const covered = this.covered();
    this.camera.aspect = this.width / (this.height + covered);
    // The globe's center sits in the middle of the part of the view the bottom sheet leaves free.
    this.camera.setViewOffset(this.width, this.height + covered, 0, covered, this.width, this.height);
    const distance = this.radius + this.altitude;
    this.camera.position.set(0, 0, distance);
    this.camera.near = Math.max(1e-3, this.altitude * 0.5);
    this.camera.far = distance + 2 * this.radius;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0, 0);
  }

  /** The point of the globe under a screen point, in the globe's own coordinates, or null off the globe. */
  toMap(sx: number, sy: number): Point3 | null {
    this.placeCamera();
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1), this.camera);
    const { origin, direction } = ray.ray;
    const b = origin.dot(direction);
    const c = origin.lengthSq() - this.radius * this.radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const hit = origin.clone().addScaledVector(direction, t);
    hit.applyQuaternion(this.globe.quaternion.clone().invert());
    return { x: hit.x, y: hit.y, z: hit.z };
  }

  /** Turns the globe so a point of it faces the camera, north up, without changing the zoom. */
  centerOnPoint(p: Point3): void {
    const forward = new Vector3(p.x, p.y, p.z).normalize();
    let east = new Vector3(0, 0, 1).cross(forward);
    if (east.lengthSq() < 1e-9) east = new Vector3(0, 1, 0).cross(forward);
    east.normalize();
    const north = forward.clone().cross(east);
    const basis = new Matrix4().makeBasis(east, north, forward).invert();
    this.globe.quaternion.setFromRotationMatrix(basis);
    this.afterCameraMove();
  }

  /** The middle of the part of the map not covered by the bottom sheet, in screen pixels. */
  viewCenter(): { x: number; y: number } {
    return { x: this.width / 2, y: (this.height - this.covered()) / 2 };
  }

  /** Turns the globe to an area without changing the zoom. */
  centerOn(area: number): void {
    const at = this.data.areas[area];
    if (at) this.centerOnPoint(at);
  }

  /** Turns the globe to an area and zooms in so that a cell spans about 40 pixels. */
  focus(area: number): void {
    const target = cellSpacing(this.data) / OPENING_CELL_PX; // km per pixel
    this.altitude = this.clampAltitude(
      (target * (this.height + this.covered())) / (2 * Math.tan((FIELD_OF_VIEW * Math.PI) / 360)),
    );
    this.centerOn(area);
  }

  /** Rotates the globe as if dragged by (dx, dy) screen pixels at its front: about the axis across the drag. */
  panBy(dx: number, dy: number): void {
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const angle = (distance * this.kmPerPixel()) / this.radius;
    const turn = new Quaternion().setFromAxisAngle(new Vector3(dy / distance, dx / distance, 0), angle);
    this.globe.quaternion.premultiply(turn);
    this.afterCameraMove();
  }

  /** Zooms by `factor`, keeping the point of the globe under the screen point (sx, sy) in place when it is on it. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.toMap(sx, sy);
    this.altitude = this.clampAltitude(this.altitude / factor);
    const after = this.toMap(sx, sy);
    if (before && after) {
      const from = new Vector3(before.x, before.y, before.z).applyQuaternion(this.globe.quaternion).normalize();
      const to = new Vector3(after.x, after.y, after.z).applyQuaternion(this.globe.quaternion).normalize();
      this.globe.quaternion.premultiply(new Quaternion().setFromUnitVectors(from, to));
    }
    this.afterCameraMove();
  }

  private clampAltitude(altitude: number): number {
    return Math.min(MAX_ALTITUDE * this.radius, Math.max(MIN_ALTITUDE * this.radius, altitude));
  }

  /** The area under a screen point, or null. */
  pick(sx: number, sy: number): number | null {
    const point = this.toMap(sx, sy);
    return point ? this.geometry.pick(point) : null;
  }

  resize(): void {
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height);
    this.labelRenderer.setSize(this.width, this.height);
    for (const material of this.lineMaterials) material.resolution.set(this.width, this.height);
    this.afterCameraMove();
  }

  private afterCameraMove(): void {
    if (this.state) this.drawOverlays(this.state);
    this.requestRender();
  }

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.placeCamera();
      this.renderLabels();
      ((this.stripes.material as ShaderMaterial).uniforms.pixelRatio as { value: number }).value =
        this.renderer.getPixelRatio();
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
    });
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    for (const group of Object.values(this.layers)) this.clear(group);
    for (const material of this.materials.values()) material.dispose();
    for (const mesh of [this.cells, this.stripes]) {
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
    }
    this.renderer.dispose();
    this.canvas.remove();
    this.labelRenderer.domElement.remove();
  }
}

/** Whether WebGL draws in software here (no graphics card, as in some virtual machines and test browsers). */
function softwareRendering(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const name = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
}

/** The stripes of the resources layer: diagonal in screen space, their width set by each cell's level. */
function stripeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      color: { value: new Color(0x0b111a) },
      period: { value: STRIPE_PERIOD_PX },
      widths: { value: STRIPE_WIDTHS.map((width) => (width / STRIPE_TILE) * STRIPE_PERIOD_PX) },
      pixelRatio: { value: 1 },
    },
    vertexShader: `
      attribute float level;
      varying float vLevel;
      void main() {
        vLevel = level;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float period;
      uniform float widths[4];
      uniform float pixelRatio;
      varying float vLevel;
      void main() {
        if (vLevel < -0.5) discard;
        float width = vLevel < 0.5 ? widths[0] : vLevel < 1.5 ? widths[1] : vLevel < 2.5 ? widths[2] : widths[3];
        float along = mod((gl_FragCoord.x + gl_FragCoord.y) / pixelRatio, period);
        if (along > width) discard;
        gl_FragColor = vec4(color, 0.7);
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** Frees an object's geometry, and its children's. */
function disposeGeometry(object: Object3D): void {
  if (object instanceof Mesh || object instanceof LineSegments) object.geometry.dispose();
  for (const child of object.children) disposeGeometry(child);
}

/** Appends a path's segments, as x1, y1, z1, x2, y2, z2 each. */
function pushPath(segments: number[], path: readonly Point3[]): void {
  for (let i = 0; i + 1 < path.length; i++) {
    const p = path[i] as Point3;
    const q = path[i + 1] as Point3;
    segments.push(p.x, p.y, p.z, q.x, q.y, q.z);
  }
}

/** Triangles fanning from a center to a closed loop of points. */
function fan(loop: Point3[], center: Point3): Point3[] {
  const triangles: Point3[] = [];
  for (let i = 0; i < loop.length; i++)
    triangles.push(center, loop[i] as Point3, loop[(i + 1) % loop.length] as Point3);
  return triangles;
}

/** Triangles of a strip given as alternating outer and inner points. */
function strip(points: Point3[]): Point3[] {
  const triangles: Point3[] = [];
  for (let i = 0; i + 3 < points.length; i += 2) {
    const [a, b, c, d] = [points[i], points[i + 1], points[i + 2], points[i + 3]] as Point3[];
    triangles.push(a as Point3, b as Point3, c as Point3, b as Point3, d as Point3, c as Point3);
  }
  return triangles;
}

/** A five-pointed star's outline in pixels, point up, as x, y pairs (y down). */
function star(outer: number, inner: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(r * Math.cos(angle), r * Math.sin(angle));
  }
  return points;
}

/** A circle of `radius` pixels as x, y pairs, without repeating its first point. */
function loop(radius: number, steps = 64): number[] {
  const points: number[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    points.push(radius * Math.cos(angle), radius * Math.sin(angle));
  }
  return points;
}

/**
 * A ring's share `fill` from the top, clockwise, as alternating outer and inner points in pixels (y down): `radius` to
 * its middle line, `width` across.
 */
function ring(radius: number, width: number, fill: number): number[] {
  const steps = Math.max(2, Math.ceil(64 * fill));
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * fill * i) / steps;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    points.push(
      (radius + width / 2) * cos,
      (radius + width / 2) * sin,
      (radius - width / 2) * cos,
      (radius - width / 2) * sin,
    );
  }
  return points;
}
