// A local PeerJS signaling server, for end-to-end tests and playing on a local network without the PeerJS cloud.
// Open the game with ?peer=localhost:9000 (or ?peer=<this machine's address>:9000 from another device).
import { PeerServer } from "peer";

const port = Number(process.env.PEER_PORT ?? 9000);
PeerServer({ port, path: "/" }, () => console.log(`PeerServer listening on port ${port}`));
