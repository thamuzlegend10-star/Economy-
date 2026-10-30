// @ts-nocheck
// Supabase Edge Function entry. Imports the shared pure engine from the repo, so deploying with the CLI bundles it.
// The service-role key comes from the function's own environment (set by Supabase), never from this repo.
import { handle } from "../../../server/verify-match.js";
Deno.serve(req => handle(req, { url: Deno.env.get("SUPABASE_URL"), key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") }));
