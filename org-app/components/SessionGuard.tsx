"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase, signOutAndGo } from "@/lib/supabaseClient";

/**
 * Munkamenet-őr: ha a bejelentkezés lejárt és nem újítható meg, a felhasználót
 * a belépő oldalra viszi — nem marad „látszólag bejelentkezve" egy olyan
 * oldalon, ahol már egyetlen mentés sem menne át.
 *  - Supabase kijelentkezés-esemény (pl. érvénytelen refresh token) → /login
 *  - előtérbe kerüléskor és percenként ellenőrzi, él-e még a munkamenet;
 *    lejárt tokent megpróbál frissíteni, ha nem megy → /login
 * A /login oldalon nem csinál semmit.
 */
export default function SessionGuard() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname.startsWith("/login")) return;
    let stopped = false;

    const check = async () => {
      if (stopped) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { await signOutAndGo(); return; }
        const exp = (session.expires_at ?? 0) * 1000;
        if (exp && exp - Date.now() < 60_000) {
          const { error } = await supabase.auth.refreshSession();
          if (error) await signOutAndGo();
        }
      } catch { /* hálózati hiba: nem dobunk ki, a következő kör újra néz */ }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (!session && event !== "INITIAL_SESSION")) {
        if (!stopped) signOutAndGo();
      }
    });
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = setInterval(check, 60_000);
    check();

    return () => {
      stopped = true;
      sub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(timer);
    };
  }, [pathname]);
  return null;
}
