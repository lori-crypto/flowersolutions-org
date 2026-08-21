"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Telepített PWA-ban (standalone) a jobbra-húzás a rendszer "vissza" gesztusa,
 * ami elnavigálna az aktuális oldalról. Ez az őr minden oldalváltás után
 * betesz egy azonos URL-ű őrszem-bejegyzést az előzményekbe: a vissza-gesztus
 * erre az őrszemre lép (a képernyő nem változik), majd az őr azonnal újra
 * felhúzza magát. Navigálni a fejléc linkjeivel lehet.
 * Normál böngészőben nem csinál semmit.
 */
export default function GestureGuard() {
  const pathname = usePathname();
  useEffect(() => {
    if (!window.matchMedia("(display-mode: standalone)").matches) return;
    // őrszem az aktuális oldal mögé (azonos URL-lel)
    history.pushState({ guard: 1 }, "");
    const onPop = () => {
      // visszaléptek az őrszemre (vagy alá) → maradunk: őrszem újra fel
      history.pushState({ guard: 1 }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [pathname]);
  return null;
}
