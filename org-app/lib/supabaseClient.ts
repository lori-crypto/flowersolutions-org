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

/** Lejárt token (JWT expired) esetén megújítja a munkamenetet és egyszer újrapróbálja.
 *  Ha a megújítás sem megy (a bejelentkezés végleg lejárt), a belépő oldalra visz,
 *  hogy a felhasználó ne gépeljen tovább egy olyan oldalon, ahol semmi nem mentődik. */
export async function withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (/jwt|token|expired|not authenticated|session/i.test((e as Error)?.message ?? "")) {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session) return await fn();
      await signOutAndGo();
    }
    throw e;
  }
}

/** Kijelentkezés: lezárja a munkamenetet, és MINDIG a belépő oldalra visz.
 *  Ha a szerver nem válaszol vagy a token már érvénytelen, helyben törli a
 *  munkamenetet — a gomb így sosem „ragad be". */
let signingOut = false;
export async function signOutAndGo(): Promise<void> {
  if (signingOut) return;           // a SIGNED_OUT esemény ne indítsa újra
  signingOut = true;
  const timeout = new Promise<void>(res => setTimeout(res, 2500));
  try { await Promise.race([supabase.auth.signOut().then(() => undefined), timeout]); } catch { /* lásd lent */ }
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* helyi törlés mindig */ }
  try {
    for (const s of [localStorage, sessionStorage]) {
      for (let i = s.length - 1; i >= 0; i--) {
        const k = s.key(i);
        if (k && k.startsWith("sb-")) s.removeItem(k);
      }
    }
  } catch { /* privát mód */ }
  if (typeof window !== "undefined") window.location.replace("/login");
}
