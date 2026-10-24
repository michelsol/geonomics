// The game: who plays, inviting more players, saving, and ending or leaving the session.
import { useGame } from "../../state/store";
import { Section } from "../components";
import { Invite, Players } from "../Players";

export function GamePanel() {
  const endGame = useGame((state) => state.endGame);
  const exportSave = useGame((state) => state.exportSave);
  const client = useGame((state) => state.session.role === "client");
  return (
    <>
      <Section title="Players">
        <Players />
        <Invite />
      </Section>

      <Section title="Session">
        <div className="row">
          {!client && (
            <button
              type="button"
              onClick={exportSave}
              title="Downloads the game as a file. It also saves itself in this browser every 30 days, and when you leave it or switch tabs."
            >
              Export save
            </button>
          )}
          <button type="button" className="danger" onClick={endGame}>
            {client ? "Leave game" : "End game"}
          </button>
        </div>
      </Section>
    </>
  );
}
