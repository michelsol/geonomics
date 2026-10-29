// Flow arrows of the migration and transport layers (specification §9, Map): their sizes and limits; surface.ts
// draws them on the globe.

/** Arrows span this part of the way between two area centers, so they never hide the centers. */
export const ARROW_START = 0.2;
export const ARROW_END = 0.8;
/** Flows below this share of the largest flow on the map are not drawn. */
export const ARROW_MIN_SHARE = 0.03;
/** An arrow needs this much room on screen; zoomed out, dense regions thin out until the player zooms in. */
export const ARROW_MIN_SPAN_PX = 14;
/** At most this many arrows, the strongest flows: more would clutter the map and slow every redraw. */
export const MAX_ARROWS = 2500;

/** Arrow width in screen pixels for a flow: 1 px plus up to 5 px, on a square-root scale of the largest flow. */
export function arrowWidth(flow: number, maximum: number): number {
  return maximum > 0 ? 1 + 5 * Math.sqrt(Math.min(1, Math.abs(flow) / maximum)) : 1;
}

/** Arrow width in screen pixels for a flow between realms: 3 px plus up to 9 px, as there are only a few. */
export function realmArrowWidth(flow: number, maximum: number): number {
  return maximum > 0 ? 3 + 9 * Math.sqrt(Math.min(1, Math.abs(flow) / maximum)) : 3;
}
