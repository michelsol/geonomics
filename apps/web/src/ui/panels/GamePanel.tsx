// The game: who plays, the planet and its pace, inviting more players, saving, and ending or leaving the session.
import { useGame } from "../../state/store";
import { count, Section } from "../components";
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

      <Planet />

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

/** The planet's size and people now, and the pace it runs at. */
function Planet() {
  const data = useGame((state) => state.data);
  const snapshot = useGame((state) => state.snapshot);
  if (!data?.map || !snapshot) return null;
  const pace = data.config.pace;
  const people = snapshot.governments.reduce((sum, government) => sum + government.population, 0);
  return (
    <Section title="Planet">
      <div className="muted" data-testid="planet">
        {count(2 * Math.PI * data.map.radius)} km around · {count(people)} people in its realms · {pace.gameDaysPerTick}{" "}
        {pace.gameDaysPerTick === 1 ? "day" : "days"} per tick · economy ×{pace.economyResponsiveness}, demography ×
        {pace.demographyResponsiveness}, military ×{pace.militaryResponsiveness}
      </div>
    </Section>
  );
}
