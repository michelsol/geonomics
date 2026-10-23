// Who is in the game, the invitation link and, for the host, releasing the realms of players who left
// (specification §10, Lobby).
import type { LobbyPlayer } from "@geonomics/net";
import type { GovernmentSummary } from "@geonomics/sim";
import { useState } from "react";
import { releaseRealm, startHosting } from "../net/host";
import { useGame } from "../state/store";
import { Swatch } from "./components";

/** Who runs a realm: its player, the AI while that player is offline, or the AI and its personality. */
export function controllerLabel(government: GovernmentSummary, players: readonly LobbyPlayer[]): string {
  const player = players.find((p) => p.government === government.id);
  if (player) return player.online ? player.name : `${player.name} (offline, AI)`;
  return government.ai ? `AI · ${government.personality}` : "Player";
}

export function Invite() {
  const session = useGame((state) => state.session);
  const toast = useGame((state) => state.toast);
  const [opening, setOpening] = useState(false);
  if (session.role === "client") return null;
  if (!session.link)
    return (
      <button
        type="button"
        disabled={opening}
        onClick={() => {
          setOpening(true);
          startHosting()
            .catch((error: unknown) => toast(`Hosting failed: ${error instanceof Error ? error.message : error}`))
            .finally(() => setOpening(false));
        }}
      >
        {opening ? "Opening…" : "Invite players"}
      </button>
    );
  return (
    <div className="section">
      <div className="row">
        <input readOnly aria-label="Join link" data-testid="join-link" value={session.link} style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() =>
            navigator.clipboard?.writeText(session.link ?? "").then(
              () => toast("Join link copied"),
              () => toast("Copy the link by hand"),
            )
          }
        >
          Copy
        </button>
      </div>
      <span className="hint">Anyone opening this link joins your game while this tab stays open.</span>
    </div>
  );
}

export function Players() {
  const session = useGame((state) => state.session);
  const governments = useGame((state) => state.governments);
  if (session.players.length === 0) return null;
  const host = session.role === "host";
  return (
    <table data-testid="players">
      <tbody>
        {session.players.map((player) => {
          const realm = player.government === null ? undefined : governments[player.government];
          return (
            <tr key={player.id}>
              <td>
                <span className={`dot ${player.online ? "online" : ""}`} title={player.online ? "online" : "offline"} />
                {player.name}
                {player.isHost ? " (host)" : ""}
                {session.me?.id === player.id ? " (you)" : ""}
              </td>
              <td>
                {realm ? (
                  <>
                    <Swatch color={realm.color} />
                    {realm.name}
                  </>
                ) : (
                  <span className="muted">{player.role === "spectator" ? "watching" : "choosing"}</span>
                )}
              </td>
              <td className="num">
                {host && !player.isHost && !player.online && player.government !== null && (
                  <button type="button" onClick={() => releaseRealm(player.government as number)}>
                    Release
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
