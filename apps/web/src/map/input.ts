// Pointer input on the map canvas: pan with a mouse or one finger, zoom with the wheel or a pinch, and tap to pick. While
// the selection brush is on, one finger or the left button paints instead, and two fingers or another button pan.
import type { MapRenderer } from "./renderer";

const TAP_DISTANCE = 6; // pixels a pointer may move and still count as a tap
const WHEEL_ZOOM = 0.0015; // zoom factor per wheel pixel

export interface MapPoint {
  x: number; // screen pixels from the canvas's top left
  y: number;
}

export interface MapHandlers {
  /** A tap; `additive` when Shift, Ctrl or Cmd was held. */
  tap(area: number | null, point: MapPoint, additive: boolean): void;
  /** Whether a pointer going down now starts a brush stroke rather than a pan. */
  brushing(): boolean;
  stroke: {
    start(point: MapPoint): void;
    move(point: MapPoint): void;
    end(): void;
    /** A second finger came down: the stroke is dropped, and the fingers pan and pinch. */
    cancel(): void;
  };
}

export function attachInput(element: HTMLElement, renderer: MapRenderer, handlers: MapHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let travelled = 0;
  let pinchDistance = 0;
  let stroking = false;

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
    if (pointers.size === 1) {
      travelled = 0;
      stroking = event.button === 0 && handlers.brushing();
      if (stroking) handlers.stroke.start(local(event));
    }
    if (pointers.size === 2) {
      if (stroking) handlers.stroke.cancel();
      stroking = false;
      pinchDistance = spread().distance;
      travelled = Number.POSITIVE_INFINITY; // a pinch is never a tap
    }
  };
  const move = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = local(event);
    if (stroking) {
      pointers.set(event.pointerId, point);
      handlers.stroke.move(point);
    } else if (pointers.size === 1) {
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
    if (stroking) {
      stroking = false;
      if (event.type === "pointercancel") handlers.stroke.cancel();
      else handlers.stroke.end();
      return;
    }
    if (!point || pointers.size > 0 || travelled >= TAP_DISTANCE) return;
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
  // While brushing, the right button pans the map instead of opening a menu.
  const menu = (event: Event) => {
    if (handlers.brushing()) event.preventDefault();
  };
  element.addEventListener("contextmenu", menu);
  return () => {
    element.removeEventListener("contextmenu", menu);
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", up);
    element.removeEventListener("wheel", wheel);
  };
}
