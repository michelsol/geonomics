// Helpers shared by the panels.
import type { GovernmentView, Snapshot, StaticData } from "@geonomics/sim";
import { useGame } from "../../state/store";

export type PanelName = "area" | "good" | "government" | "policies" | "orders" | "jobs" | "armies" | "diplomacy";
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

export function goodOptions(data: StaticData, storableOnly = false) {
  return data.goods
    .filter((good) => !storableOnly || !good.isService)
    .map((good) => ({ value: good.id, label: good.name }));
}

export function ownedOptions(view: View) {
  return view.government.ownedAreas.map((area) => ({ value: area, label: areaName(view.data, area) }));
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
