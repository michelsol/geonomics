// Helpers shared by the panels.
import { type GovernmentView, type Snapshot, type StaticData, WAGE_BAND_BOUNDARIES } from "@geonomics/sim";
import { type PanelName, useGame } from "../../state/store";

export type { PanelName };

/** A wage band in words: "under 0.5 mh/h", "0.5–1 mh/h", "over 2 mh/h"; null for every band. */
export function bandName(band: number | null): string {
  if (band === null) return "all bands";
  const low = WAGE_BAND_BOUNDARIES[band - 1];
  const high = WAGE_BAND_BOUNDARIES[band];
  if (low === undefined) return `under ${high} mh/h`;
  if (high === undefined) return `over ${low} mh/h`;
  return `${low}–${high} mh/h`;
}

/** A consumer group in words: its wage band, or "unemployed" for the last group. */
export function groupName(group: number): string {
  return group < WAGE_BAND_BOUNDARIES.length + 1 ? bandName(group) : "unemployed";
}
export interface PanelProps {
  onOpen: (panel: PanelName) => void;
}

export interface View {
  data: StaticData;
  snapshot: Snapshot;
  government: GovernmentView;
}

/** Static data and the latest snapshot, with the player's government if it holds one (spectators do not). */
export function usePublicView(): (Omit<View, "government"> & { government: GovernmentView | null }) | null {
  const data = useGame((state) => state.data);
  const snapshot = useGame((state) => state.snapshot);
  if (!data || !snapshot) return null;
  return { data, snapshot, government: snapshot.government };
}

/** Static data, the latest snapshot and the player's government, once the first snapshot arrived. */
export function useView(): View | null {
  const data = useGame((state) => state.data);
  const snapshot = useGame((state) => state.snapshot);
  if (!data || !snapshot?.government) return null;
  return { data, snapshot, government: snapshot.government };
}

export const areaName = (data: StaticData, area: number) => data.areas[area]?.name ?? `#${area}`;

/**
 * The areas an information panel shows: the selection or, when nothing is selected, the player's realm (the whole
 * map for a spectator), with a heading naming them.
 */
export function shownAreas(
  data: StaticData,
  government: GovernmentView | null,
  selection: readonly number[],
): { areas: readonly number[]; heading: string } {
  if (selection.length === 1) return { areas: selection, heading: areaName(data, selection[0] as number) };
  if (selection.length > 1) return { areas: selection, heading: `${selection.length.toLocaleString("en-US")} areas` };
  if (government) return { areas: government.ownedAreas, heading: "Your realm" };
  return { areas: data.areas.map((_, area) => area), heading: "The world" };
}

/** Goods for a dropdown, sorted by name, optionally only those `keep` accepts. */
export function goodOptions(data: StaticData, keep: (good: StaticData["goods"][number]) => boolean = () => true) {
  return data.goods
    .filter(keep)
    .map((good) => ({ value: good.id, label: good.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export const storable = (good: StaticData["goods"][number]) => !good.isService;

/** Sends a command to the worker; the answer comes back as a snapshot or a rejection toast. */
export function useSend() {
  return useGame((state) => state.send);
}

export function AreaLink({ area }: { area: number }) {
  const data = useGame((state) => state.data);
  const select = useGame((state) => state.selectArea);
  if (!data) return null;
  return (
    <button type="button" className="link" onClick={() => select(area)}>
      {areaName(data, area)}
    </button>
  );
}

/** Shown by the action panels when the selection holds none of the player's areas: there is nothing to act on. */
export function NoOwnArea() {
  return (
    <p className="muted" data-testid="no-own-area">
      None of your areas is selected. Select some of yours, or clear the selection to act on your whole realm.
    </p>
  );
}
