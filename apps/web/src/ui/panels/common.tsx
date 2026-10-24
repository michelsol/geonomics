// Helpers shared by the panels.
import type { GovernmentView, Snapshot, StaticData } from "@geonomics/sim";
import type { SelectionSummary } from "../../state/selectors";
import { type PanelName, useGame } from "../../state/store";
import { fmt, Stat } from "../components";

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

/**
 * Income, real income and cost of living of some areas, for a stats grid: what a worker earns, what that buys here,
 * and how dear the needs are (specification §10, Panels). `testIds` prefixes the stats' test ids.
 */
export function IncomeStats({
  summary,
  hoursPerDay,
  several,
  testIds = "",
}: {
  summary: SelectionSummary;
  hoursPerDay: number;
  several: boolean;
  testIds?: string;
}) {
  const mean = several ? " Population-weighted mean over the areas." : "";
  return (
    <>
      <Stat
        label="Income"
        value={`${fmt(summary.wageLevel * hoursPerDay)} mh/day`}
        testId={`${testIds}income`}
        title={`Value added per employed worker and day, in man-hours (an hour of an average worker's labor): with no capital or profits, the worker's whole income.${mean}`}
      />
      <Stat
        label="Real income"
        value={`${fmt(summary.realIncomeLevel * hoursPerDay)} mh/day`}
        testId={`${testIds}real-income`}
        title={`What the income buys at labor-value prices: the income over the cost of living.${mean}`}
      />
      <Stat
        label="Cost of living"
        value={summary.costOfLiving === null ? "—" : `×${fmt(summary.costOfLiving)}`}
        testId={`${testIds}cost-of-living`}
        title={`The local price of a typical basket of needs over its labor value: ×1 when needs cost what they take to make, more where they are dear.${mean}`}
      />
    </>
  );
}
