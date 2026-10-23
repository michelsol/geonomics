// Secrets, set with `wrangler secret put`; `wrangler types` only sees the vars in wrangler.jsonc.
interface Env {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}
