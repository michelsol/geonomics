// How to play (specification §9, Screens): a short guide, opened from the new game screen.
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
            does to prices, incomes and people. There is no score and no victory: play for as long as you like.
          </p>
        </section>

        <section>
          <h2>The map</h2>
          <p>
            Tap or click an area to see it in the Area panel. Drag to pan, and pinch or scroll to zoom. To work on a
            whole region, turn on the Brush in the bar above the panels and paint over its areas; Erase takes some out,
            and two fingers or a right-button drag move the map meanwhile. Shift-click adds or removes one area. Taxes,
            jobs, recruits and standing orders apply to your areas in the selection, shown in the bar, or to your whole
            realm when it holds none of them. Each panel colors the map with what it is about: realms for Area, Armies,
            Diplomacy and Game; the price of a good for Goods; population; necessities met for Needs; terrain striped
            where a resource is found for Resources; real net incomes for Policies; employment for Jobs. Goods and
            Population can also draw goods and people on the move. Dashed lines are sea routes, dotted lines air routes.
          </p>
        </section>

        <section>
          <h2>The economy</h2>
          <p>
            Every area produces, consumes and trades with its neighbors on its own. Prices rise where goods are short
            and fall where they pile up, so goods flow from cheap areas to dear ones, and people move toward work and
            food. Money is counted in man-hours (mh): one hour of an average worker's labor. Prices are public: the
            Goods panel shows where each good is cheapest and dearest. The Population and Needs panels show where people
            are born, die and move, and what they lack.
          </p>
        </section>

        <section>
          <h2>Running your realm</h2>
          <ul>
            <li>
              <b>Policies</b>: an income tax by wage band, with a row for the unemployed (negative: a benefit), a head
              tax (negative: an allowance for everyone), consumption taxes and tariffs per good (a negative tax is a
              subsidy), price ceilings and floors, for the selection or the whole realm. People buy with what they earn,
              so the unemployed and the low-paid feel dear food first. Taxes fill your treasury but slow the economy
              down. Standing orders buy cheap and sell dear for your depots on their own.
            </li>
            <li>
              <b>Depots</b>: the Area panel shows what your government holds in the selected areas, bought on the
              market, produced by government jobs or taken as taxes in kind.
            </li>
            <li>
              <b>Jobs</b>: hire workers to produce goods for your depots.
            </li>
            <li>
              <b>Infrastructure</b>: build ports, airports, roads and forts up to level 3, paying from the treasury into
              the area as it is built, or take them down at once. Each level needs staff, paid a share of the local
              wage; without them it does not run. Better roads and ports carry more trade for less. A port also lets the
              area work the sea around it: fish and, further out, offshore oil and gas in the water cells within as many
              hops of the coast as its level, shared with any other port reaching them.
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
            In the lobby or the Game tab, Invite players gives a link to send, and a six-letter code to read out:
            friends type it under Join with a code. They pick a free realm or watch, and play in the same world; your
            browser runs the game, so keep its tab open. If a friend drops out, the AI runs their realm until they come
            back.
          </p>
        </section>

        <section>
          <h2>Saving</h2>
          <p>
            Games save themselves in this browser every 30 days, when you switch away from the tab and when you end the
            game; Continue picks them up from the menu. Export save in the Game tab downloads the game as a file, which
            anyone can load from the menu to host it again.
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
