// Flow arrows of the migration and transport layers (specification §10, Map): geometry only, so it is testable
// without a renderer.

/** Arrows span this part of the segment between two area centers, so they never hide the centers. */
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

/**
 * Polygon of an arrow from (x1, y1) toward (x2, y2): a shaft of `width` and a triangular head, shifted `offset` to
 * the right of travel (screen coordinates, y down), as flat x, y pairs. `px` is one screen pixel in map units, so heads
 * keep a readable size at every zoom. `grow` enlarges the arrow on every side, for an outline drawn under it. Returns
 * null when the segment is too short to hold an arrow.
 */
export function arrowPolygon(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  offset: number,
  px: number,
  grow = 0,
): number[] | null {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const span = (ARROW_END - ARROW_START) * length;
  if (span < ARROW_MIN_SPAN_PX * px) return null;
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const nx = -uy; // to the right of travel when y points down
  const ny = ux;
  const headHalf = Math.max(width, 3.5 * px);
  const headLength = Math.min(0.5 * span, 2 * headHalf);
  const half = width / 2 + grow;
  const sx = x1 + ux * (ARROW_START * length - grow) + nx * offset;
  const sy = y1 + uy * (ARROW_START * length - grow) + ny * offset;
  const ex = x1 + ux * (ARROW_END * length + 2 * grow) + nx * offset;
  const ey = y1 + uy * (ARROW_END * length + 2 * grow) + ny * offset;
  const bx = x1 + ux * (ARROW_END * length - headLength - grow) + nx * offset;
  const by = y1 + uy * (ARROW_END * length - headLength - grow) + ny * offset;
  const wing = headHalf + 1.5 * grow;
  return [
    sx - nx * half,
    sy - ny * half,
    bx - nx * half,
    by - ny * half,
    bx - nx * wing,
    by - ny * wing,
    ex,
    ey,
    bx + nx * wing,
    by + ny * wing,
    bx + nx * half,
    by + ny * half,
    sx + nx * half,
    sy + ny * half,
  ];
}
