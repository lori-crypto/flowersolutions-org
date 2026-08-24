import { createClient } from "@supabase/supabase-js";

// KIZÁRÓLAG szerveroldali használatra (API route-ok): a service-kulcs
// megkerüli az RLS-t. Böngésző-kódba importálni TILOS.
const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");

export function supabaseAdmin() {
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("Hiányzó Supabase szerver-konfiguráció.");
  return createClient(url, key, { auth: { persistSession: false } });
}
