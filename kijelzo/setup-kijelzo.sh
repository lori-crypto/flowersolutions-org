#!/usr/bin/env bash
# =====================================================================
# Flower Solutions - FALI KIJELZO (szabadsagos tabla) EGYSZERI telepitoje
# a Linux print-szerverre. Sudo nelkul fut; ahol megis rendszergazda kell,
# ott NEM csinal semmit, csak kiirja a pontos parancsot.
# =====================================================================
# Mit csinal:
#   1) Megnezi, milyen bongeszo es grafikus kornyezet van a gepen
#   2) Keszit egy indito scriptet (~/kijelzo/start-kijelzo.sh), ami
#        - megvarja, amig van halozat (kulonben hibaoldal ragadna a monitoron)
#        - kikapcsolja a kepernyo-elalvast
#        - teljes kepernyon (kioszk) megnyitja a kijelzo-oldalt
#        - ha a bongeszo bezarul vagy osszeomlik, ujrainditja
#   3) Beallitja, hogy bejelentkezeskor magatol induljon (autostart)
#   4) Kiirja, mi hianyzik meg (ha hianyzik valami)
#
# Hasznalat:
#   A) Masold fel:        scp setup-kijelzo.KESZ.sh lori@<SZERVER-IP>:~
#   B) A szerveren:       bash ~/setup-kijelzo.KESZ.sh
#   Ujrafuttathato: mindig felulirja a sajat fajljait, mast nem bant.
#   Eltavolitas:          bash ~/setup-kijelzo.KESZ.sh --torol
# =====================================================================

# ============ BEALLITAS ==============================================
# A teljes kijelzo-cim a kulccsal. A *.KESZ.sh valtozatban mar ki van toltve.
#   &tabla=2  -> masik tabla   |  &valt=30 -> 30 mp-enkent valt a tablak kozott
KIJELZO_URL="${KIJELZO_URL:-IDE_A_KIJELZO_CIM}"
# =====================================================================

set -u
USER="${USER:-$(id -un)}"
DIR="$HOME/kijelzo"
AUTOSTART="$HOME/.config/autostart/fs-kijelzo.desktop"
MARK_BEGIN="# >>> fs-kijelzo >>>"
MARK_END="# <<< fs-kijelzo <<<"

strip_block() {  # kiveszi a sajat blokkunkat egy fajlbol (ha van)
  [ -f "$1" ] || return 0
  sed -i "/^$MARK_BEGIN\$/,/^$MARK_END\$/d" "$1"
}

if [ "${1:-}" = "--torol" ]; then
  pkill -f "$DIR/start-kijelzo.sh" 2>/dev/null || true
  rm -f "$AUTOSTART" "$DIR/start-kijelzo.sh" "$HOME/.xinitrc.fs-kijelzo"
  strip_block "$HOME/.bash_profile"; strip_block "$HOME/.profile"
  echo ">> Kijelzo eltavolitva (a bongeszo-profil megmaradt: $DIR/profil)."
  exit 0
fi

case "$KIJELZO_URL" in
  http*://*key=*) ;;
  *) echo "HIBA: a KIJELZO_URL nincs kitoltve (a *.KESZ.sh valtozatot hasznald, abban benne van)."; exit 1 ;;
esac

mkdir -p "$DIR"
echo "== Flower Solutions fali kijelzo telepitese =="

# ---- 1) helyzetfelmeres ---------------------------------------------
OS="$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -sr)"
BROWSER=""
for b in chromium-browser chromium google-chrome google-chrome-stable firefox firefox-esr; do
  if command -v "$b" >/dev/null 2>&1; then BROWSER="$(command -v "$b")"; break; fi
done
HAS_X=0; command -v startx >/dev/null 2>&1 && HAS_X=1
DM=""
for s in gdm3 gdm lightdm sddm; do
  if systemctl is-enabled "$s" >/dev/null 2>&1; then DM="$s"; break; fi
done
SESSIONS="$(ls /usr/share/xsessions /usr/share/wayland-sessions 2>/dev/null | grep -c '\.desktop$' || true)"
echo ">> Rendszer:            $OS"
echo ">> Bongeszo:            ${BROWSER:-NINCS}"
echo ">> Grafikus belepteto:  ${DM:-nincs}   (asztali kornyezetek szama: ${SESSIONS:-0})"

# ---- 2) indito script ------------------------------------------------
cat > "$DIR/start-kijelzo.sh" <<STARTEOF
#!/usr/bin/env bash
# Flower Solutions fali kijelzo - indito (a setup-kijelzo.sh irta, ne szerkeszd kezzel)
URL='$KIJELZO_URL'
DIR="\$HOME/kijelzo"
LOG="\$DIR/kijelzo.log"
exec >>"\$LOG" 2>&1
echo "--- \$(date '+%F %T') indulas"

# egyszerre csak egy peldany fusson
exec 9>"\$DIR/.lock"; flock -n 9 || { echo "mar fut, kilepek"; exit 0; }

# bongeszo keresese
BROWSER=""
for b in chromium-browser chromium google-chrome google-chrome-stable firefox firefox-esr; do
  if command -v "\$b" >/dev/null 2>&1; then BROWSER="\$(command -v "\$b")"; break; fi
done
[ -z "\$BROWSER" ] && { echo "HIBA: nincs bongeszo telepitve"; exit 1; }

# kepernyo-elalvas ki (X alatt; Wayland alatt ez egyszeruen nem csinal semmit)
if command -v xset >/dev/null 2>&1; then xset s off; xset -dpms; xset s noblank; fi
command -v unclutter >/dev/null 2>&1 && (unclutter -idle 1 &)

API="\${URL%%/kijelzo/*}/api/kijelzo/szabadsag?\${URL#*\?}"
while true; do
  # megvarjuk, amig a szerver tenyleg valaszol - igy sosem hibaoldal indul
  until curl -fsS -m 10 -o /dev/null "\$API"; do
    echo "\$(date '+%T') nincs kapcsolat, varok..."; sleep 10
  done
  case "\$BROWSER" in
    *firefox*)
      "\$BROWSER" --kiosk --profile "\$DIR/profil-ff" --no-remote "\$URL" ;;
    *)
      # a "nem megfeleloen zarult be" buborek elkerulese
      PREF="\$DIR/profil/Default/Preferences"
      [ -f "\$PREF" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "\$PREF"
      "\$BROWSER" --kiosk --no-first-run --noerrdialogs --disable-infobars \\
        --disable-session-crashed-bubble --disable-translate --disable-features=Translate \\
        --password-store=basic --check-for-update-interval=31536000 \\
        --user-data-dir="\$DIR/profil" "\$URL" ;;
  esac
  echo "\$(date '+%T') a bongeszo kilepett (\$?), 5 mp mulva ujrainditom"
  sleep 5
done
STARTEOF
chmod +x "$DIR/start-kijelzo.sh"
echo ">> indito kesz: $DIR/start-kijelzo.sh"

# ---- 3) automatikus indulas -----------------------------------------
TODO=""
if [ -n "$DM" ] || [ "${SESSIONS:-0}" -gt 0 ]; then
  # --- A eset: van asztali kornyezet -> XDG autostart (sudo nelkul) ---
  mkdir -p "$(dirname "$AUTOSTART")"
  cat > "$AUTOSTART" <<DESKEOF
[Desktop Entry]
Type=Application
Name=FS fali kijelzo
Comment=Flower Solutions szabadsagos tabla - kioszk
Exec=$DIR/start-kijelzo.sh
X-GNOME-Autostart-enabled=true
Terminal=false
DESKEOF
  echo ">> autostart beallitva: $AUTOSTART"
  # automatikus bejelentkezes ellenorzese (enelkul ujrainditas utan a belepo kepernyo all a monitoron)
  AUTOLOGIN=0
  grep -Eqs "^\s*AutomaticLoginEnable\s*=\s*[Tt]rue" /etc/gdm3/custom.conf /etc/gdm/custom.conf 2>/dev/null && AUTOLOGIN=1
  grep -Eqs "^\s*autologin-user\s*=\s*\S+" /etc/lightdm/lightdm.conf /etc/lightdm/lightdm.conf.d/*.conf 2>/dev/null && AUTOLOGIN=1
  grep -Eqs "^\s*User\s*=\s*\S+" /etc/sddm.conf /etc/sddm.conf.d/*.conf 2>/dev/null && AUTOLOGIN=1
  if [ "$AUTOLOGIN" = 0 ]; then
    case "$DM" in
      gdm3|gdm) TODO="$TODO
  * Automatikus bejelentkezes (GDM):  sudo nano /etc/gdm3/custom.conf   -> a [daemon] ala:
        AutomaticLoginEnable=True
        AutomaticLogin=$USER" ;;
      lightdm) TODO="$TODO
  * Automatikus bejelentkezes (LightDM):
        printf '[Seat:*]\nautologin-user=$USER\nautologin-user-timeout=0\n' | sudo tee /etc/lightdm/lightdm.conf.d/50-fs-kijelzo.conf" ;;
      *) TODO="$TODO
  * Allitsd be az automatikus bejelentkezest a(z) $USER felhasznalora (Beallitasok -> Felhasznalok)." ;;
    esac
  fi
else
  # --- B eset: nincs asztali kornyezet (szerver) -> minimal X a tty1-en ---
  cat > "$HOME/.xinitrc.fs-kijelzo" <<XEOF
#!/bin/sh
# Flower Solutions fali kijelzo - minimal X munkamenet
command -v openbox >/dev/null 2>&1 && openbox &
exec $DIR/start-kijelzo.sh
XEOF
  chmod +x "$HOME/.xinitrc.fs-kijelzo"
  PROFILE="$HOME/.bash_profile"; [ -f "$PROFILE" ] || PROFILE="$HOME/.profile"
  strip_block "$PROFILE"
  cat >> "$PROFILE" <<PEOF
$MARK_BEGIN
# a gep sajat kepernyojen (tty1) belepve automatikusan indul a fali kijelzo; SSH-n nem
if [ -z "\${DISPLAY:-}" ] && [ "\$(tty)" = "/dev/tty1" ] && command -v startx >/dev/null 2>&1; then
  exec startx "\$HOME/.xinitrc.fs-kijelzo" -- -nocursor >"\$HOME/kijelzo/x.log" 2>&1
fi
$MARK_END
PEOF
  echo ">> tty1-es indulas beallitva: $PROFILE"
  [ "$HAS_X" = 0 ] && TODO="$TODO
  * Grafikus alap telepitese (kb. 150 MB):
        sudo apt update && sudo apt install -y --no-install-recommends xserver-xorg xinit openbox x11-xserver-utils unclutter"
  if ! grep -qs -- "--autologin" /etc/systemd/system/getty@tty1.service.d/*.conf 2>/dev/null; then
    TODO="$TODO
  * Automatikus bejelentkezes a gep kepernyojen (tty1):
        sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
        printf '[Service]\nExecStart=\nExecStart=-/sbin/agetty --autologin $USER --noclear %%I \$TERM\n' | sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf
        sudo systemctl daemon-reload"
  fi
fi

[ -z "$BROWSER" ] && TODO="$TODO
  * Bongeszo telepitese:
        sudo apt install -y chromium-browser   (ha ilyen csomag nincs: sudo apt install -y chromium  vagy  sudo snap install chromium)"
command -v curl >/dev/null 2>&1 || TODO="$TODO
  * sudo apt install -y curl"

# ---- 4) osszefoglalo --------------------------------------------------
echo ""
if [ -n "$TODO" ]; then
  echo "== MEG HATRAVAN (rendszergazdai jog kell hozza) =="
  echo "$TODO"
  echo ""
  echo "Ezek utan:  sudo reboot   -> a monitoron magatol megjelenik a tabla."
else
  echo "== KESZ. =="
  echo "Ujrainditas utan magatol indul. Azonnali probahoz (a gep sajat kepernyojen, grafikus munkamenetben):"
  echo "    $DIR/start-kijelzo.sh &"
fi
echo "Naplo:  $DIR/kijelzo.log"
