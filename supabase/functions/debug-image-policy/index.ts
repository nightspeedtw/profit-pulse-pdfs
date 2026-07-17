// Diagnostic endpoint — reports runtime image-provider policy state.
import { readImageProviderPolicy } from "../_shared/image-providers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async () => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const policy = await readImageProviderPolicy(db);
  return new Response(JSON.stringify({
    has_runware_key: !!Deno.env.get("RUNWARE_API_KEY"),
    has_cf_creds: !!Deno.env.get("CF_ACCOUNT_ID") && !!Deno.env.get("CF_API_TOKEN"),
    has_fal_key: !!Deno.env.get("FAL_KEY") || !!Deno.env.get("FAL_API_KEY"),
    policy,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
