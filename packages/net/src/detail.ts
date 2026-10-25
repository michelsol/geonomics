// Area detail for remote players in turns (specification §8, Snapshots): every snapshot carries the area the player
// looks at plus the next batch of its visible areas, so a large realm stays within the size budget and every area is
// refreshed within a few snapshots.
import type { AreaId } from "@geonomics/sim";

/** Visible areas whose detail goes in each snapshot to a remote player, beside the focused area. */
export const DETAIL_BATCH = 48;

export class DetailRotation {
  private cursor = 0;
  focus: AreaId | null = null;

  constructor(private readonly batch = DETAIL_BATCH) {}

  /** The areas to detail in the next snapshot; pass as SnapshotOptions.detailAreas. */
  readonly pick = (visible: readonly AreaId[]): AreaId[] => {
    if (visible.length <= this.batch) return [...visible];
    const picked = new Set<AreaId>();
    if (this.focus !== null && visible.includes(this.focus)) picked.add(this.focus);
    const start = this.cursor % visible.length;
    for (let k = 0; k < this.batch; k++) picked.add(visible[(start + k) % visible.length] as AreaId);
    this.cursor = (start + this.batch) % visible.length;
    return [...picked].sort((a, b) => a - b);
  };
}
