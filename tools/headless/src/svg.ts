// Debug view of a generated map: Voronoi cells by terrain, realms, water, land edges, sea and air routes, capitals.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Terrain, World } from "@geonomics/sim";
import { Delaunay } from "d3-delaunay";

const TERRAIN_COLORS: Record<Terrain, string> = {
  plains: "#b7d48b",
  forest: "#5f9a57",
  hills: "#c8b27a",
  mountains: "#9a8f86",
  desert: "#e6d29a",
};

export function writeMapSvg(world: World, path: string): void {
  const map = world.map;
  if (!map) throw new Error("This world has no generated map to draw");
  const points: number[] = [];
  for (const area of world.areas) points.push(area.position.x, area.position.y);
  for (const value of map.waterPoints) points.push(value);
  const voronoi = new Delaunay(Float64Array.from(points)).voronoi([0, 0, map.width, map.height]);
  const cells: string[] = [];
  const cellCount = points.length / 2;
  for (let i = 0; i < cellCount; i++) {
    const area = world.areas[i];
    const fill = area ? TERRAIN_COLORS[area.terrain] : "#4f7fb5";
    cells.push(`<path d="${voronoi.renderCell(i)}" fill="${fill}" stroke="${area ? "#00000022" : fill}"/>`);
    const owner = area?.owner === null || area === undefined ? undefined : world.governments[area.owner];
    if (owner) {
      cells.push(
        `<path d="${voronoi.renderCell(i)}" fill="${owner.color}" fill-opacity="0.45" stroke="${owner.color}" stroke-width="4"/>`,
      );
    }
  }

  const lines: string[] = [];
  for (const edge of world.edges) {
    if (!edge.isActive) continue;
    const a = world.areas[edge.areaA]?.position;
    const b = world.areas[edge.areaB]?.position;
    if (!a || !b) continue;
    const style =
      edge.mode === "land"
        ? 'stroke="#55443355" stroke-width="2"'
        : edge.mode === "sea"
          ? 'stroke="#1d3d73" stroke-width="3" stroke-dasharray="12 8"'
          : 'stroke="#b0303a" stroke-width="3" stroke-dasharray="3 9"';
    lines.push(
      `<line x1="${a.x.toFixed(0)}" y1="${a.y.toFixed(0)}" x2="${b.x.toFixed(0)}" y2="${b.y.toFixed(0)}" ${style}/>`,
    );
  }

  const markers: string[] = [];
  for (const area of world.areas) {
    const { x, y } = area.position;
    if (area.airportLevel > 0)
      markers.push(`<rect x="${x - 12}" y="${y - 12}" width="24" height="24" fill="#b0303a"/>`);
    else if (area.portLevel > 0) markers.push(`<circle cx="${x}" cy="${y}" r="8" fill="#1d3d73"/>`);
  }
  for (const government of world.governments) {
    const area = government.capital === null ? undefined : world.areas[government.capital];
    if (area) {
      markers.push(
        `<circle cx="${area.position.x}" cy="${area.position.y}" r="40" fill="#ffd700" stroke="#000" stroke-width="6"/>`,
      );
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${map.width} ${map.height}" width="${Math.round(map.width / 4)}" height="${Math.round(map.height / 4)}">
<rect width="${map.width}" height="${map.height}" fill="#4f7fb5"/>
${cells.join("\n")}
${lines.join("\n")}
${markers.join("\n")}
</svg>
`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg);
}
