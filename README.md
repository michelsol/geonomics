# Geonomics

A geographic economics sandbox in the browser. The map is split into areas that each produce, consume, trade and set their own prices; you run a realm on top of that living economy — taxes, markets, roads and ports, armies — alone, against AI realms, or with friends through a link.

**Play:** <https://michelsol.github.io/geonomics/>. It installs as an app on phones and plays offline once loaded. The game's "How to play" screen covers the rules in short.

## Documentation

| Document | Holds |
| --- | --- |
| [docs/specification/](docs/specification/README.md) | The rules of the game, section by section |
| [docs/design-notes.md](docs/design-notes.md) | Why the rules are what they are: measurements, tuning and findings |
| [docs/roadmap.md](docs/roadmap.md) | The build order, stage by stage, and open questions |
| [apps/broker/README.md](apps/broker/README.md) | The Cloudflare Worker that connects players, and its TURN relay |

## Development

Node 24 and pnpm. `pnpm install`, then from the repository root:

| Command | Does |
| --- | --- |
| `pnpm dev` | Starts the Vite development server for the web app |
| `pnpm build` | Builds the web app into `apps/web/dist` |
| `pnpm test` / `pnpm test:watch` | Runs every Vitest project |
| `pnpm typecheck` | Type-checks every package |
| `pnpm lint` / `pnpm format` | Checks or fixes lint and formatting with Biome |
| `pnpm headless` | Runs the headless runner: scenarios, diagnostics, AI games |
| `pnpm e2e` | Runs the Playwright browser tests |
| `pnpm broker` | Runs the connection broker locally (port 8787) |

| Path | Holds |
| --- | --- |
| `packages/sim` | The simulation: data model, tick, commands, AI, map generation, save format. No browser or network dependency |
| `packages/net` | Multiplayer: PeerJS host and client, messages and their encoding |
| `apps/web` | The React interface, the PixiJS map and the simulation worker |
| `apps/broker` | The Cloudflare Worker broker |
| `tools/headless` | Node runner for balance testing |
| `data/goods` | The goods catalogs (small, medium, large) |

Pushing to `main` runs CI and deploys the web app to GitHub Pages.

## License

See [LICENSE](LICENSE).
