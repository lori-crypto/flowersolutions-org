"use client";
import { useEffect } from "react";

/**
 * Telepített PWA-ban (standalone) a jobbra-húzás a rendszer "vissza" gesztusa,
 * ami kilépne az aktuális oldalról (pl. Szabadság → Szervezési tábla).
 * Ez a csapda elnyeli a vissza-navigációt: navigálni a fejléc linkjeivel lehet.
 * Normál böngészőben nem csinál semmit (ott kell a vissza gomb).
 */
export default function GestureGuard() {
  useEffect(() => {
    if (!window.matchMedia("(display-mode: standalone)").matches) return;
    history.pushState({ guard: 1 }, "");
    const onPop = () => history.pushState({ guard: 1 }, "");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return null;
}
