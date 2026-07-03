// Passcode-gated admin data client. The admin panel uses passcode auth
// (no Supabase session), so all RLS-protected reads must be proxied
// through the `admin-data` edge function running with service role.
import { supabase } from "@/integrations/supabase/client";

const PASSCODE_KEY = "admin_passcode_ok";
// Kept in sync with src/pages/admin/Login.tsx. Client-side only —
// the edge function validates against the server-side `ADMIN_PASSCODE` secret.
const CLIENT_PASSCODE = "453451";

function passcode(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(PASSCODE_KEY) === "1" ? CLIENT_PASSCODE : "";
}

export async function fetchAdminData<T = unknown>(
  resource: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-data", {
    body: { resource, passcode: passcode(), ...extra },
    headers: { "x-admin-passcode": passcode() },
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

