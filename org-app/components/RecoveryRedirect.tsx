"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * Jelszó-visszaállító linkről érkezés: a Supabase a linkről egy munkamenettel
 * (#access_token=…&type=recovery) irányít vissza — ha nem az új-jelszó oldalra
 * érkezik (pl. a Site URL gyökerére), a felhasználó egyszerűen „be lenne lépve"
 * jelszóváltás nélkül. Ez az őr minden oldalon figyel, és ilyenkor átviszi a
 * /login/uj-jelszo oldalra, ahol az új jelszó megadható.
 *  - URL-hash alapján azonnal (type=recovery), a hash megtartásával;
 *  - és a Supabase PASSWORD_RECOVERY eseményére is, ha a hash már feldolgozódott.
 */
export default function RecoveryRedirect() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname.startsWith("/login/uj-jelszo")) return;
    const go = () => window.location.replace("/login/uj-jelszo" + window.location.hash);
    const h = window.location.hash;
    if (/type=recovery/.test(h) || /error_code=otp_expired/.test(h)) { go(); return; }
    const { data: sub } = supabase.auth.onAuthStateChange(event => {
      if (event === "PASSWORD_RECOVERY") go();
    });
    return () => sub.subscription.unsubscribe();
  }, [pathname]);
  return null;
}
