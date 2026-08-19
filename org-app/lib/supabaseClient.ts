import { createClient } from "@supabase/supabase-js";

// Böngésző-oldali kliens: kizárólag az anon (publishable) kulcs!
// Minden hozzáférést a Postgres RLS véd.
// A placeholder csak a build-időt (prerender) éli túl env nélkül;
// futásidőben a valós NEXT_PUBLIC_* értékek kellenek (.env.local / Vercel env).
// Védekezés a beállításkor véletlenül bekerülő idézőjelek/szóközök ellen.
const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "");

// „Maradjak bejelentkezve": ha a belépéskor NEM kérte a megjegyzést, a munkamenet
// csak sessionStorage-ba kerül → a böngésző bezárásával lejár. Ha kérte (alapeset),
// localStorage-ba → tartósan bejelentkezve marad.
export const REMEMBER_KEY = "fsorg-remember";
const isBrowser = typeof window !== "undefined";
const store = () =>
  isBrowser && localStorage.getItem(REMEMBER_KEY) === "0" ? sessionStorage : localStorage;
const authStorage = {
  getItem: (k: string) =>
    isBrowser ? (localStorage.getItem(k) ?? sessionStorage.getItem(k)) : null,
  setItem: (k: string, v: string) => { if (isBrowser) store().setItem(k, v); },
  removeItem: (k: string) => {
    if (isBrowser) { localStorage.removeItem(k); sessionStorage.removeItem(k); }
  },
};

export const supabase = createClient(
  clean(process.env.NEXT_PUBLIC_SUPABASE_URL) || "https://placeholder.supabase.co",
  clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || "placeholder-anon-key",
  { auth: { persistSession: true, autoRefreshToken: true, storage: authStorage } }
);
