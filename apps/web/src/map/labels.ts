// Realm names on the map (specification §9, Map): where each name goes and how tall it is, in km. Layout only, so it
// is testable without a renderer.
import type { GovernmentSummary, Point3, Snapshot, StaticData } from "@geonomics/sim";
import { centerOf } from "../state/selectors";

export interface RealmLabel {
  government: number;
  text: string;
  at: Point3;
  size: number; // text height in km
}

/** A name may run this much wider than its realm, about the square root of its area count in cells. */
const WIDTH_OVER_REALM = 1.2;
/** Width of a letter in capitals, letter spacing included, over the text height. */
const LETTER_WIDTH = 0.7;
/** Tallest name, in mean cell spacings. */
const MAXIMUM_SIZE = 5;

/** The mean spacing between cell centers, in km: the cells share the sphere's surface. */
export function cellSpacing(data: Pick<StaticData, "areas" | "waters" | "map">): number {
  const cells = data.areas.length + data.waters.length;
  return data.map && cells > 0 ? Math.sqrt((4 * Math.PI * data.map.radius ** 2) / cells) : 1;
}

/**
 * One label per realm that holds land: its name in capitals, on the owned area nearest the population-weighted center
 * of its areas (so it always sits on the realm's own land), sized so it spans about the realm's width: the square root
 * of its area count, in cells, over the name's length.
 */
export function realmLabels(
  data: Pick<StaticData, "areas" | "waters" | "map">,
  snapshot: Snapshot,
  governments: readonly GovernmentSummary[],
): RealmLabel[] {
  const owner = snapshot.areas.owner;
  const population = snapshot.areas.population;
  const cell = cellSpacing(data);
  const members = governments.map(() => ({ ids: [] as number[], people: [] as number[] }));
  for (const [id] of data.areas.entries()) {
    const entry = members[owner[id] ?? -1];
    if (!entry) continue;
    entry.ids.push(id);
    entry.people.push(Math.max(population[id] as number, 1e-9));
  }
  const labels: RealmLabel[] = [];
  for (const [g, government] of governments.entries()) {
    const { ids, people } = members[g] as (typeof members)[number];
    if (government.isEliminated || ids.length === 0) continue;
    const center = centerOf(
      data,
      ids.map((id) => data.areas[id] as StaticData["areas"][number]),
      people,
    );
    let nearest = ids[0] as number;
    let best = Number.POSITIVE_INFINITY;
    for (const id of ids) {
      const area = data.areas[id] as StaticData["areas"][number];
      const d = (area.x - center.x) ** 2 + (area.y - center.y) ** 2 + (area.z - center.z) ** 2;
      if (d < best) {
        best = d;
        nearest = id;
      }
    }
    const at = data.areas[nearest] as StaticData["areas"][number];
    const text = government.name.toUpperCase();
    const fit = (WIDTH_OVER_REALM * Math.sqrt(ids.length)) / (LETTER_WIDTH * Math.max(4, text.length));
    labels.push({ government: g, text, at: { x: at.x, y: at.y, z: at.z }, size: cell * Math.min(MAXIMUM_SIZE, fit) });
  }
  return labels;
}
