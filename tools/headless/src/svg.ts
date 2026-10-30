// Debug view of a generated map, as a world map (longitude across, latitude up): Voronoi cells by terrain, realms,
// water cells by depth and the ports' reach, land edges, sea and air routes, armies and capitals. Cells and lines
// crossing the date line are left out.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Point3, sphericalVoronoi, type Terrain, toLonLat, type World, waterReachOf } from "@geonomics/sim";

const TERRAIN_COLORS: Record<Terrain, string> = {
  plains: "#b7d48b",
  forest: "#5f9a57",
  hills: "#c8b27a",
  mountains: "#9a8f86",
  desert: "#e6d29a",
  coldDesert: "#e8eef2",
};

const WATER_COLORS = ["#6f9bcc", "#5f8cc0", "#5483b8"]; // depth 1 to 3; deeper is #4f7fb5
const WIDTH = 2400; // pixels for 360 degrees of longitude
const SCALE = WIDTH / 360;

const project = (p: Point3): [number, number] => {
  const [longitude, latitude] = toLonLat(p);
  return [(longitude + 180) * SCALE, (90 - latitude) * SCALE];
};
/** Whether projected points span more than half the map's width: the shape wraps around the date line. */
const wraps = (xs: number[]) => Math.max(...xs) - Math.min(...xs) > WIDTH / 2;

export function writeMapSvg(world: World, path: string): void {
  const map = world.map;
  if (!map) throw new Error("This world has no generated map to draw");
  const sites = [...world.areas.map((area) => area.position), ...world.waters.map((water) => water.position)];
  const voronoi = sphericalVoronoi(sites, map.radius);
  const reached = new Set(waterReachOf(world).flatMap((cells) => cells.map((cell) => cell.water)));
  const cells: string[] = [];
  for (let i = 0; i < sites.length; i++) {
    const corners = (voronoi.polygons[i] ?? []).map(project);
    if (corners.length < 3 || wraps(corners.map(([x]) => x))) continue;
    const d = `M${corners.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
    const area = world.areas[i];
    const water = world.waters[i - world.areas.length];
    const fill = area ? TERRAIN_COLORS[area.terrain] : (WATER_COLORS[(water?.depth ?? 0) - 1] ?? "#4f7fb5");
    cells.push(`<path d="${d}" fill="${fill}" stroke="${area ? "#00000022" : fill}" stroke-width="0.5"/>`);
    if (water && reached.has(water.id)) cells.push(`<path d="${d}" fill="#ffffff" fill-opacity="0.25"/>`);
    const owner = area?.owner === null || area === undefined ? undefined : world.governments[area.owner];
    if (owner) cells.push(`<path d="${d}" fill="${owner.color}" fill-opacity="0.45" stroke="${owner.color}"/>`);
  }

  const lines: string[] = [];
  for (const edge of world.edges) {
    if (!edge.isActive) continue;
    const a = world.areas[edge.areaA]?.position;
    const b = world.areas[edge.areaB]?.position;
    if (!a || !b) continue;
    const [x1, y1] = project(a);
    const [x2, y2] = project(b);
    if (wraps([x1, x2])) continue;
    const style =
      edge.mode === "land"
        ? 'stroke="#55443355" stroke-width="0.5"'
        : edge.mode === "sea"
          ? 'stroke="#1d3d73" stroke-width="0.8" stroke-dasharray="3 2"'
          : 'stroke="#b0303a" stroke-width="0.8" stroke-dasharray="1 2"';
    lines.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ${style}/>`,
    );
  }

  const markers: string[] = [];
  for (const area of world.areas) {
    const [x, y] = project(area.position);
    if (area.airportLevel > 0) markers.push(`<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="#b0303a"/>`);
    else if (area.portLevel > 0) markers.push(`<circle cx="${x}" cy="${y}" r="2" fill="#1d3d73"/>`);
  }
  for (const army of world.armies.values()) {
    const area = world.areas[army.location.kind === "area" ? army.location.area : army.location.from];
    const color = world.governments[army.owner]?.color ?? "#000";
    if (area) {
      const [x, y] = project(area.position);
      markers.push(`<path d="M${x} ${y - 7}L${x + 6} ${y + 4}L${x - 6} ${y + 4}Z" fill="${color}" stroke="#000"/>`);
    }
  }
  for (const government of world.governments) {
    const area = government.capital === null ? undefined : world.areas[government.capital];
    if (area) {
      const [x, y] = project(area.position);
      markers.push(`<circle cx="${x}" cy="${y}" r="8" fill="#ffd700" stroke="#000" stroke-width="1.5"/>`);
    }
  }

  const height = WIDTH / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}">
<rect width="${WIDTH}" height="${height}" fill="#4f7fb5"/>
${cells.join("\n")}
${lines.join("\n")}
${markers.join("\n")}
</svg>
`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg);
}
