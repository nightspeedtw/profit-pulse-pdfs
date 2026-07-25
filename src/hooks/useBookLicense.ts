// Reads the current user's owned license for a single book, if any.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface OwnedLicense {
  license_type: "personal" | "commercial";
  commercial_rights_active: boolean;
  granted_at: string;
}

export function useBookLicense(bookId: string | null | undefined) {
  const [license, setLicense] = useState<OwnedLicense | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!bookId) {
      setLicense(null);
      setLoading(false);
      return;
    }
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) {
      setLicense(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("book_licenses_owned")
      .select("license_type,commercial_rights_active,granted_at")
      .eq("user_id", uid)
      .eq("book_id", bookId)
      .maybeSingle();
    setLicense((data as OwnedLicense) ?? null);
    setLoading(false);
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { license, loading, refresh: load };
}
