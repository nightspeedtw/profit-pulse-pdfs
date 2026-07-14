// Reports which cost-saving API keys are wired for this project.
// Returns booleans only — NEVER the values.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const body = {
    ok: true,
    keys: {
      gemini_direct: !!(Deno.env.get('GEMINI_API_KEY') && Deno.env.get('GEMINI_API_KEY')!.length > 10),
      fal_direct: !!(Deno.env.get('FAL_API_KEY') ?? Deno.env.get('FAL_KEY')),
      lovable_gateway: !!Deno.env.get('LOVABLE_API_KEY'),
    },
  };
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
