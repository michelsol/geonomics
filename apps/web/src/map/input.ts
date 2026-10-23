// Pointer input on the map canvas: pan with a mouse or one finger, zoom with the wheel or a pinch, tap to pick, and
// double-tap, with a mouse or a finger alike.
import type { MapRenderer } from "./renderer";

const TAP_DISTANCE = 6; // pixels a pointer may move and still count as a tap
const DOUBLE_TAP_MS = 300; // a second tap this soon after the first, and this close, is a double tap
const DOUBLE_TAP_DISTANCE = 24;
const WHEEL_ZOOM = 0.0015; // zoom factor per wheel pixel

export interface MapPoint {
  x: number; // screen pixels from the canvas's top left
  y: number;
}

export interface MapHandlers {
  /** A tap; `additive` when Shift, Ctrl or Cmd was held. */
  tap(area: number | null, point: MapPoint, additive: boolean): void;
  /** The second tap of a double tap, instead of a second `tap`. */
  doubleTap(point: MapPoint): void;
}

export function attachInput(element: HTMLElement, renderer: MapRenderer, handlers: MapHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let travelled = 0;
  let pinchDistance = 0;
  let lastTap = { at: Number.NEGATIVE_INFINITY, x: 0, y: 0 };

  const local = (event: PointerEvent | WheelEvent) => {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const spread = () => {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const down = (event: PointerEvent) => {
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 1) travelled = 0;
    if (pointers.size === 2) {
      pinchDistance = spread().distance;
      travelled = Number.POSITIVE_INFINITY; // a pinch is never a tap
    }
  };
  const move = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = local(event);
    if (pointers.size === 1) {
      renderer.panBy(point.x - previous.x, point.y - previous.y);
      travelled += Math.hypot(point.x - previous.x, point.y - previous.y);
      pointers.set(event.pointerId, point);
    } else if (pointers.size === 2) {
      const before = spread();
      pointers.set(event.pointerId, point);
      const after = spread();
      renderer.panBy(after.x - before.x, after.y - before.y);
      if (pinchDistance > 0) renderer.zoomAt(after.x, after.y, after.distance / pinchDistance);
      pinchDistance = after.distance;
    }
  };
  const up = (event: PointerEvent) => {
    const point = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (!point || pointers.size > 0 || travelled >= TAP_DISTANCE) return;
    const now = performance.now();
    if (
      now - lastTap.at < DOUBLE_TAP_MS &&
      Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < DOUBLE_TAP_DISTANCE
    ) {
      lastTap = { at: Number.NEGATIVE_INFINITY, x: 0, y: 0 };
      handlers.doubleTap(point);
      return;
    }
    lastTap = { at: now, ...point };
    handlers.tap(renderer.pick(point.x, point.y), point, event.shiftKey || event.ctrlKey || event.metaKey);
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const { x, y } = local(event);
    renderer.zoomAt(x, y, Math.exp(-event.deltaY * WHEEL_ZOOM));
  };

  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", up);
  element.addEventListener("wheel", wheel, { passive: false });
  return () => {
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", up);
    element.removeEventListener("wheel", wheel);
  };
}
