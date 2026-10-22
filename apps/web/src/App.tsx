// Top-level screen switch (specification §10, Screens).
import { lazy, Suspense } from "react";
import { useGame } from "./state/store";
import { ChooseRealm, EndOfSession, NewGame } from "./ui/screens";

// The game screen brings PixiJS and uPlot; loading it lazily keeps the first screen light on phones.
const Game = lazy(() => import("./ui/Game").then((module) => ({ default: module.Game })));

export function App() {
  const screen = useGame((state) => state.screen);
  switch (screen) {
    case "newGame":
      return <NewGame />;
    case "chooseRealm":
      return <ChooseRealm />;
    case "game":
      return (
        <Suspense fallback={<main className="screen">Loading the map…</main>}>
          <Game />
        </Suspense>
      );
    case "ended":
      return <EndOfSession />;
  }
}
