// ============================================================
// FS Hőmérséklet-figyelő — ESP32 panel program
//
//  • Percenként megméri az összes DS18B20 szondát (szondánként külön láb,
//    de egy lábon több szonda is lehet — mindegyiket az egyedi azonosítója
//    alapján ismeri fel a rendszer)
//  • Elküldi a Supabase-nek (temp_ingest RPC, eszközkulccsal)
//  • Ha nincs internet, a méréseket eltárolja (kb. 12 órányit 4 szondával),
//    és amint visszajön a net, időbélyeggel pótolja → nincs lyuk a grafikonon
//  • Első indításkor (vagy a BOOT gomb 5 mp-es nyomására) saját Wi-Fi-t nyit:
//    „FS-Homero-XXXX" — telefonnal rácsatlakozva megadható a Wi-Fi és a kulcs
//  • Helyi hálózaton át frissíthető (ArduinoOTA)
//
// Alaplap: „ESP32 Dev Module" (Plusivo ESP32). Könyvtárak: lásd README.md.
// ============================================================

#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <esp_task_wdt.h>
#include <time.h>
#include "config.h"   // SUPABASE_URL, SUPABASE_ANON_KEY — lásd config.example.h

#define FW_VERSION "1.0.0"

// Szondák lábai: mindegyikre egy szonda (adat vezeték) + egy 4,7 kΩ felhúzó ellenállás 3V3-ra.
static const uint8_t PROBE_PINS[] = {4, 16, 17, 18, 19, 21, 22, 23};
static const int NPINS = sizeof(PROBE_PINS) / sizeof(PROBE_PINS[0]);
static const uint8_t LED_PIN = 2;   // beépített kék LED
static const uint8_t BTN_PIN = 0;   // BOOT gomb

static const uint32_t MEASURE_MS   = 60UL * 1000;
static const uint32_t RECONNECT_MS = 2UL * 60 * 1000;
static const int      BUF_MAX      = 3000;   // tárolható mérés (16 bájt/db → 48 KB)
static const int      BATCH_MAX    = 150;    // egy küldésben legfeljebb ennyi

struct Reading { uint8_t addr[8]; int16_t centi; uint32_t ts; };
static Reading buf[BUF_MAX];
static int bufHead = 0, bufLen = 0;

static OneWire* ow[NPINS];
static DallasTemperature* dt[NPINS];
static Preferences prefs;
static String deviceKey;
static String hostName;
static bool badKey = false;
static uint32_t nextMeasure = 0, lastReconnect = 0;

// ── Tároló (gyűrűpuffer) ─────────────────────────────────────
static void bufPush(const uint8_t* a, float c, uint32_t ts) {
  if (bufLen == BUF_MAX) { bufHead = (bufHead + 1) % BUF_MAX; bufLen--; }   // a legrégebbi megy ki
  Reading& r = buf[(bufHead + bufLen) % BUF_MAX];
  memcpy(r.addr, a, 8);
  r.centi = (int16_t)lroundf(c * 100.0f);
  r.ts = ts;
  bufLen++;
}
static void bufDrop(int n) { n = min(n, bufLen); bufHead = (bufHead + n) % BUF_MAX; bufLen -= n; }

static String addrHex(const uint8_t* a) {
  char s[17];
  for (int i = 0; i < 8; i++) sprintf(s + i * 2, "%02X", a[i]);
  return String(s);
}

static bool timeValid() { return time(nullptr) > 1700000000; }

static void blink(int n, int ms) {
  for (int i = 0; i < n; i++) { digitalWrite(LED_PIN, HIGH); delay(ms); digitalWrite(LED_PIN, LOW); delay(ms); }
}

// ── Mérés ────────────────────────────────────────────────────
static void measure() {
  for (int p = 0; p < NPINS; p++) {
    dt[p]->begin();                    // újraszámolja a szondákat (menet közben bedugott szonda is látszik)
    dt[p]->setResolution(12);
    dt[p]->setWaitForConversion(false);
    dt[p]->requestTemperatures();
  }
  delay(800);                          // 12 bites konverzió ideje
  uint32_t ts = timeValid() ? (uint32_t)time(nullptr) : 0;
  int found = 0;
  for (int p = 0; p < NPINS; p++) {
    int n = dt[p]->getDeviceCount();
    for (int i = 0; i < n; i++) {
      DeviceAddress a;
      if (!dt[p]->getAddress(a, i)) continue;
      float c = dt[p]->getTempC(a);
      if (c == DEVICE_DISCONNECTED_C || c == 85.0f || c < -55 || c > 125) continue;  // 85,0 = bekapcsolási hamis érték
      bufPush(a, c, ts);
      found++;
      Serial.printf("  láb %d  %s  %.2f °C\n", PROBE_PINS[p], addrHex(a).c_str(), c);
    }
  }
  Serial.printf("Mérés: %d szonda, tárolva: %d\n", found, bufLen);
}

// ── Küldés ───────────────────────────────────────────────────
// true = sikerült (és a küldött tételek kikerültek a tárolóból)
static bool sendBatch() {
  if (bufLen == 0 || WiFi.status() != WL_CONNECTED) return false;
  int n = min(bufLen, BATCH_MAX);

  JsonDocument doc;
  doc["p_key"] = deviceKey;
  doc["p_rssi"] = WiFi.RSSI();
  doc["p_fw"] = FW_VERSION;
  JsonArray arr = doc["p_readings"].to<JsonArray>();
  for (int i = 0; i < n; i++) {
    const Reading& r = buf[(bufHead + i) % BUF_MAX];
    JsonObject o = arr.add<JsonObject>();
    o["a"] = addrHex(r.addr);
    o["t"] = r.centi / 100.0;
    if (r.ts) o["ts"] = r.ts;
  }
  String body;
  serializeJson(doc, body);

  WiFiClientSecure client;
  // A forgalom titkosított (HTTPS). A szerver-tanúsítványt nem ellenőrizzük, hogy egy
  // tanúsítványcsere ne némítsa el a paneleket; a hamisítás ellen az eszközkulcs véd.
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(client, String(SUPABASE_URL) + "/rest/v1/rpc/temp_ingest")) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  int code = http.POST(body);
  String resp = code > 0 ? http.getString() : String();
  http.end();

  if (code != 200) {
    Serial.printf("Küldés hiba: HTTP %d %s\n", code, resp.c_str());
    return false;
  }
  JsonDocument r;
  if (deserializeJson(r, resp) || !(r["ok"] | false)) {
    badKey = String((const char*)(r["error"] | "")) == "unknown_device";
    Serial.printf("Elutasítva: %s\n", resp.c_str());
    return false;
  }
  badKey = false;
  bufDrop(n);
  Serial.printf("Elküldve: %d, maradt: %d\n", n, bufLen);
  return true;
}

// ── Beállítás (telefonos portál) ─────────────────────────────
static bool saveFlag = false;

static void runPortal(bool force) {
  WiFiManager wm;
  char keyBuf[80];
  strlcpy(keyBuf, deviceKey.c_str(), sizeof(keyBuf));
  WiFiManagerParameter keyParam("key", "Eszközkulcs (a Managment rendszerből, 64 karakter)", keyBuf, 70);
  wm.addParameter(&keyParam);
  wm.setSaveParamsCallback([]() { saveFlag = true; });
  wm.setSaveConfigCallback([]() { saveFlag = true; });
  wm.setTitle("FS Hőmérséklet-figyelő");
  wm.setConfigPortalTimeout(force ? 0 : 180);
  wm.setConnectTimeout(30);

  String ap = "FS-Homero-" + hostName.substring(hostName.length() - 4);
  bool ok = force ? wm.startConfigPortal(ap.c_str()) : wm.autoConnect(ap.c_str());

  String k = String(keyParam.getValue());
  k.trim();
  if ((saveFlag || force) && k.length() >= 32 && k != deviceKey) {
    deviceKey = k;
    prefs.putString("key", deviceKey);
    Serial.println("Eszközkulcs elmentve.");
  }
  Serial.println(ok ? "Wi-Fi csatlakozva." : "Wi-Fi nincs — mérés tovább, később újrapróbálom.");
}

static void checkButton() {
  if (digitalRead(BTN_PIN) != LOW) return;
  uint32_t t0 = millis();
  while (digitalRead(BTN_PIN) == LOW) {
    if (millis() - t0 > 5000) {
      Serial.println("BOOT gomb 5 mp: beállító portál.");
      blink(10, 50);
      esp_task_wdt_delete(NULL);
      runPortal(true);
      ESP.restart();
    }
    delay(20);
  }
}

static void setupWatchdog() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = { .timeout_ms = 120000, .idle_core_mask = 0, .trigger_panic = true };
  if (esp_task_wdt_reconfigure(&cfg) != ESP_OK) esp_task_wdt_init(&cfg);
#else
  esp_task_wdt_init(120, true);
#endif
  esp_task_wdt_add(NULL);
}

// ── Indulás ──────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BTN_PIN, INPUT_PULLUP);
  delay(200);
  Serial.printf("\nFS Hőmérséklet-figyelő %s\n", FW_VERSION);

  for (int p = 0; p < NPINS; p++) {
    ow[p] = new OneWire(PROBE_PINS[p]);
    dt[p] = new DallasTemperature(ow[p]);
  }

  uint8_t mac[6];
  WiFi.macAddress(mac);
  char hn[24];
  sprintf(hn, "fs-homero-%02x%02x", mac[4], mac[5]);
  hostName = hn;

  prefs.begin("homero", false);
  deviceKey = prefs.getString("key", "");

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(hostName.c_str());
  WiFi.setAutoReconnect(true);
  runPortal(deviceKey.length() < 32);   // kulcs nélkül addig vár a portálon, amíg be nem állítják

  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com", "time.google.com");

  ArduinoOTA.setHostname(hostName.c_str());
  ArduinoOTA.setPassword(deviceKey.substring(0, 12).c_str());   // OTA-jelszó = a kulcs első 12 karaktere
  ArduinoOTA.onStart([]() { esp_task_wdt_delete(NULL); });
  ArduinoOTA.begin();

  setupWatchdog();
  nextMeasure = millis();
}

void loop() {
  esp_task_wdt_reset();
  ArduinoOTA.handle();
  checkButton();

  if (WiFi.status() != WL_CONNECTED && millis() - lastReconnect > RECONNECT_MS) {
    lastReconnect = millis();
    Serial.println("Wi-Fi újracsatlakozás…");
    WiFi.reconnect();
  }

  if ((int32_t)(millis() - nextMeasure) >= 0) {
    nextMeasure += MEASURE_MS;
    measure();
    bool ok = false;
    for (int i = 0; i < 6 && bufLen > 0; i++) {      // lemaradás pótlása: egyszerre max. 900 mérés
      esp_task_wdt_reset();
      if (!sendBatch()) break;
      ok = true;
    }
    if (badKey) blink(5, 80);                       // 5 gyors villanás: rossz/törölt kulcs
    else if (ok) blink(1, 60);                      // 1 villanás: rendben elküldve
    else if (WiFi.status() != WL_CONNECTED) blink(3, 250);  // 3 lassú: nincs Wi-Fi
  }
  delay(20);
}
