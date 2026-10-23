// How to play (specification §10, Screens): a short guide, opened from the new game screen.
import { useGame } from "../state/store";

export function Guide() {
  const closeGuide = useGame((state) => state.closeGuide);
  return (
    <main className="screen">
      <article className="card guide">
        <h1>How to play</h1>

        <section>
          <h2>The idea</h2>
          <p>
            Geonomics is a sandbox. The map is split into areas, each with its own people, resources, workers and
            market. You run one realm on top of that living economy: you tax, trade, build and fight, and watch what it
            does to prices, wages and people. There is no score and no victory: play for as long as you like.
          </p>
        </section>

        <section>
          <h2>The map</h2>
          <p>
            Tap or click an area to see it in the Area panel. Drag to pan, and pinch or scroll to zoom. The layer menu
            colors the map by realm, population, the price of a good, resources, satisfaction, wages or terrain; the
            flows menu draws migration or goods on the move. Dashed lines are sea routes, dotted lines air routes.
          </p>
        </section>

        <section>
          <h2>The economy</h2>
          <p>
            Every area produces, consumes and trades with its neighbors on its own. Prices rise where goods are short
            and fall where they pile up, so goods flow from cheap areas to dear ones, and people move toward work and
            food. Money is counted in man-hours (mh): one hour of an average worker's labor. Prices are public: the Good
            section, at the bottom of the Area panel, shows where each good is cheapest and dearest.
          </p>
        </section>

        <section>
          <h2>Running your realm</h2>
          <ul>
            <li>
              <b>Policies</b>: taxes and tariffs (a negative tax is a subsidy), head tax, price ceilings and floors, for
              the whole realm or one area. Taxes fill your treasury but slow the economy down. Standing orders buy cheap
              and sell dear for your depots on their own.
            </li>
            <li>
              <b>Depots</b>: the Area panel shows what your government holds in an area, and sends goods between your
              areas.
            </li>
            <li>
              <b>Jobs</b>: hire workers to build roads, ports, airports and fortifications, or to produce goods. Better
              roads and ports carry more trade for less.
            </li>
          </ul>
        </section>

        <section>
          <h2>War and peace</h2>
          <p>
            Recruit soldiers in the Armies panel, arm them with weapons from your depots, and march them on the map.
            Declaring war blocks trade and migration across the front. An army that beats an area's defenders besieges
            it, and takes it when the siege completes. Peace is proposed in the Diplomacy panel, with areas and money
            changing hands; the other side may refuse.
          </p>
        </section>

        <section>
          <h2>The other realms</h2>
          <p>
            Realms nobody plays are run by the AI, each with a personality you see in the lobby and the Diplomacy panel:
            traders build ports and trade, builders build roads and fortifications, conquerors raise armies and go to
            war.
          </p>
        </section>

        <section>
          <h2>Playing with friends</h2>
          <p>
            In the lobby or the Realm panel, Invite players gives a link to send. Your friends open it, pick a free
            realm or watch, and play in the same world; your browser runs the game, so keep its tab open. If a friend
            drops out, the AI runs their realm until they come back.
          </p>
        </section>

        <section>
          <h2>Saving</h2>
          <p>
            Games save themselves in this browser every 30 days, when you switch away from the tab and when you end the
            game; Continue picks them up from the menu. Export save in the Realm panel downloads the game as a file,
            which anyone can load from the menu to host it again.
          </p>
        </section>

        <section>
          <h2>On a phone</h2>
          <p>
            Install Geonomics from the browser menu (Add to Home screen, or Install app) to play full screen and
            offline. Panels sit in a sheet at the bottom: tap the handle to make it taller. Phones pause games in the
            background, so a phone host should keep the game on screen.
          </p>
        </section>

        <button type="button" className="primary" onClick={closeGuide}>
          Back
        </button>
      </article>
    </main>
  );
}
