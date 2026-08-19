import { createClient } from "@supabase/supabase-js";

// Böngésző-oldali kliens: kizárólag az anon (publishable) kulcs!
// Minden hozzáférést a Postgres RLS véd.
// A placeholder csak a build-időt (prerender) éli túl env nélkül;
// futásidőben a valós NEXT_PUBLIC_* értékek kellenek (.env.local / Vercel env).
// Védekezés a beállításkor véletlenül bekerülő idézőjelek/szóközök ellen.
const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");

export const supabase = createClient(
  clean(process.env.NEXT_PUBLIC_SUPABASE_URL) || "https://placeholder.supabase.co",
  clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || "placeholder-anon-key",
  { auth: { persistSession: true, autoRefreshToken: true } }
);
