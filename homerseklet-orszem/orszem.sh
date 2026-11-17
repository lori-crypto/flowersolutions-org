#!/usr/bin/env bash
# ============================================================
# Hőmérséklet-figyelő — második ellenőr a helyi printszerveren.
#
# 2 percenként megnézi, hogy a felhőben fut-e a riasztó-ellenőrzés (pg_cron).
# Ha 5 percnél régebben futott, vagy a felhő nem érhető el, MAGA küld
# Telegram-üzenetet — így ha a riasztórendszer áll, arról is tudunk.
# Egy hibáról egyszer szól, és szól, amikor helyreállt.
#
# Beállítás: /etc/fs-homero-orszem.env (minta: orszem.env.example)
# ============================================================
set -u
ENV_FILE="${ENV_FILE:-/etc/fs-homero-orszem.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"
STATE_DIR="${STATE_DIR:-/var/lib/fs-homero-orszem}"
mkdir -p "$STATE_DIR"
STATE="$STATE_DIR/state"
prev="$(cat "$STATE" 2>/dev/null || echo ok)"

send() {
  curl -fsS -m 20 "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT_ID}" --data-urlencode "text=$1" >/dev/null
}

problem=""
resp="$(curl -fsS -m 20 -X POST "${SUPABASE_URL}/rest/v1/rpc/temp_health" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" -d '{}' 2>/dev/null)" || problem="A hőmérséklet-figyelő felhője nem érhető el a Központból."

if [ -z "$problem" ]; then
  age="$(printf '%s' "$resp" | python3 -c 'import json,sys
d=json.load(sys.stdin); lc=d.get("last_check") or 0
print(int((d["now"]-lc)/60) if lc else 9999)' 2>/dev/null || echo 9999)"
  if [ "$age" -gt 5 ]; then
    problem="A riasztó-ellenőrzés ${age} perce nem futott — a Telegram-riasztások most NEM működnek! (Supabase → pg_cron)"
  fi
fi

if [ -n "$problem" ] && [ "$prev" = "ok" ]; then
  send "🛑 Második ellenőr (printszerver): $problem" && echo "bad" > "$STATE"
elif [ -z "$problem" ] && [ "$prev" = "bad" ]; then
  send "✅ Második ellenőr: a hőmérséklet-riasztás újra működik." && echo "ok" > "$STATE"
fi
