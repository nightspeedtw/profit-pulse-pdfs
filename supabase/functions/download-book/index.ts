// POST /download-book  { bookId }
// Returns a short-lived signed URL for the book PDF if the caller owns any
// license (personal or commercial) for it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/paddle.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const BUCKET = 'ebook-pdfs';
const TTL_SECONDS = 600;
const MAX_USES = 5;

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function extractStoragePath(pdfUrl: string): string | null {
  try {
    const u = new URL(pdfUrl);
    const marker = `/object/`;
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    // .../object/(sign|public|authenticated)/<bucket>/<path>
    const tail = u.pathname.slice(idx + marker.length);
    const parts = tail.split('/');
    // parts[0] = sign|public|authenticated, parts[1] = bucket, rest = path
    if (parts.length < 3) return null;
    return parts.slice(2).join('/');
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return j(405, { error: 'method_not_allowed' });

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return j(401, { error: 'unauthenticated' });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) return j(401, { error: 'unauthenticated' });
  const userId = userRes.user.id;

  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {
    return j(400, { error: 'invalid_json' });
  }
  const bookId: string | undefined = body?.bookId;
  if (!bookId) return j(400, { error: 'missing_bookId' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: owned } = await admin
    .from('book_licenses_owned')
    .select('license_type')
    .eq('user_id', userId)
    .eq('book_id', bookId)
    .maybeSingle();
  if (!owned) return j(403, { error: 'not_licensed' });

  const { data: book } = await admin
    .from('ebooks_kids')
    .select('pdf_url')
    .eq('id', bookId)
    .maybeSingle();
  if (!book?.pdf_url) return j(404, { error: 'pdf_not_ready' });

  const path = extractStoragePath(book.pdf_url);
  if (!path) return j(500, { error: 'invalid_pdf_path' });

  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    return j(500, { error: 'sign_failed', details: signErr?.message });
  }

  const token = crypto.randomUUID();
  await admin.from('download_tokens').insert({
    user_id: userId,
    book_id: bookId,
    token,
    license_type: owned.license_type,
    expires_at: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
    max_uses: MAX_USES,
  });

  return j(200, { url: signed.signedUrl, licenseType: owned.license_type });
});
