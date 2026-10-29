// Realm names on the map (specification §9, Map): where each name goes and how tall it is, in map units. Layout
// only, so it is testable without a renderer.
import type { GovernmentSummary, Snapshot, StaticData } from "@geonomics/sim";

export interface RealmLabel {
  government: number;
  text: string;
  x: number;
  y: number;
  size: number; // text height in map units
}

/** A name may run this much wider than its realm, about the square root of its area count in cells. */
const WIDTH_OVER_REALM = 1.2;
/** Width of a letter in capitals, letter spacing included, over the text height. */
const LETTER_WIDTH = 0.7;
/** Tallest name, in mean cell spacings. */
const MAXIMUM_SIZE = 5;

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
  const cells = data.areas.length + data.waters.length;
  const cell = data.map && cells > 0 ? Math.sqrt((data.map.width * data.map.height) / cells) : 1;
  const sums = governments.map(() => ({ x: 0, y: 0, people: 0, areas: 0 }));
  for (const [id, area] of data.areas.entries()) {
    const sum = sums[owner[id] ?? -1];
    if (!sum) continue;
    const people = Math.max(population[id] as number, 1e-9);
    sum.x += people * area.x;
    sum.y += people * area.y;
    sum.people += people;
    sum.areas++;
  }
  const labels: RealmLabel[] = [];
  for (const [g, government] of governments.entries()) {
    const sum = sums[g] as (typeof sums)[number];
    if (government.isEliminated || sum.areas === 0) continue;
    const cx = sum.x / sum.people;
    const cy = sum.y / sum.people;
    let nearest = -1;
    let best = Number.POSITIVE_INFINITY;
    for (const [id, area] of data.areas.entries()) {
      if (owner[id] !== g) continue;
      const d = (area.x - cx) ** 2 + (area.y - cy) ** 2;
      if (d < best) {
        best = d;
        nearest = id;
      }
    }
    const at = data.areas[nearest] as StaticData["areas"][number];
    const text = government.name.toUpperCase();
    const fit = (WIDTH_OVER_REALM * Math.sqrt(sum.areas)) / (LETTER_WIDTH * Math.max(4, text.length));
    labels.push({ government: g, text, x: at.x, y: at.y, size: cell * Math.min(MAXIMUM_SIZE, fit) });
  }
  return labels;
}
