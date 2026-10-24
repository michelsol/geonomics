// Helpers shared by the panels.
import type { GovernmentView, Snapshot, StaticData } from "@geonomics/sim";
import { type PanelName, useGame } from "../../state/store";

export type { PanelName };
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

export function goodOptions(data: StaticData, storableOnly = false) {
  return data.goods
    .filter((good) => !storableOnly || !good.isService)
    .map((good) => ({ value: good.id, label: good.name }));
}

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
