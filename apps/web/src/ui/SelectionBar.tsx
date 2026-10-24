// The selection, under the tabs on every panel (specification §10, Selection): what is selected, what the player's
// actions apply to, and the controls choosing it.
import { mapControls } from "../map/MapView";
import { actionTarget } from "../state/selectors";
import { gameStore, useGame } from "../state/store";
import { count, Swatch } from "./components";
import { areaName } from "./panels/common";

export function SelectionBar() {
  const data = useGame((state) => state.data);
  const snapshot = useGame((state) => state.snapshot);
  const selection = useGame((state) => state.selection);
  const brushing = useGame((state) => state.mode.kind === "brush");
  const { selectAreas, selectArea, setMode } = gameStore.getState();
  if (!data || !snapshot) return null;
  const government = snapshot.government;
  const single = selection.length === 1 ? (selection[0] as number) : null;
  const owner = single === null ? undefined : snapshot.governments[snapshot.areas.owner[single] as number];
  const target = government ? actionTarget(government, selection) : null;
  const yours = government ? selection.filter((area) => government.ownedAreas.includes(area)).length : 0;

  const center = () => {
    const capital = government?.capital ?? null;
    const targets = selection.length > 0 ? selection : capital !== null ? [capital] : [];
    if (targets.length === 0) return;
    let x = 0;
    let y = 0;
    for (const area of targets) {
      x += data.areas[area]?.x ?? 0;
      y += data.areas[area]?.y ?? 0;
    }
    mapControls.renderer?.centerOnPoint(x / targets.length, y / targets.length);
  };

  return (
    <div className="selection-bar" data-testid="selection-bar">
      <div className="selection-what">
        <div className="selection-name">
          {single !== null ? (
            <>
              {owner && <Swatch color={owner.color} />}
              {areaName(data, single)}
            </>
          ) : selection.length > 1 ? (
            <span data-testid="selection-count">{count(selection.length)} areas</span>
          ) : (
            "Nothing selected"
          )}
        </div>
        {target && (
          <div className="muted" data-testid="action-target">
            Actions:{" "}
            {target.realm
              ? "your whole realm"
              : single !== null
                ? areaName(data, single)
                : yours === 1
                  ? "your 1 area"
                  : `your ${count(yours)} areas`}
          </div>
        )}
      </div>
      <div className="group">
        {government && government.ownedAreas.length > 1 && (
          <button type="button" onClick={() => selectAreas(government.ownedAreas)}>
            My realm
          </button>
        )}
        <button
          type="button"
          className={brushing ? "active" : ""}
          aria-pressed={brushing}
          title="Paint over areas to select several. Shift-click also adds or removes one area."
          onClick={() => setMode({ kind: brushing ? "select" : "brush" })}
        >
          Brush
        </button>
        <button
          type="button"
          className="icon"
          aria-label="Center"
          title="Center the map on the selection"
          onClick={center}
        >
          ⌖
        </button>
        {selection.length > 0 && (
          <button type="button" aria-label="Clear" title="Select nothing" onClick={() => selectArea(null)}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
