// Drift Game 2 - ESP32 controller firmware (WiFi / WebSocket version - home network)
// ===================================================================================
// 8 push buttons: 4 per player (GAS, BRAKE, LEFT, RIGHT). If you only play
// alone (Practice / 1 player), only player 1's 4 buttons need to be wired.
//
// This version connects the ESP32 to your computer WIRELESSLY through your
// HOME WIFI NETWORK (the USB cable is only needed for power, e.g. from a
// power bank).
//
// NOTE: browsers only allow this plain ws:// connection when the game itself
// is served over http:// (e.g. locally with start.bat). On an https:// site
// such as GitHub Pages use the USB firmware (drift_controller.ino).
//
// How it works:
// - The ESP32 joins the WiFi network below (the same one your computer is on).
// - It starts a WebSocket server on port 81.
// - The browser game connects to it (ws://<ESP32-IP>:81/) and receives both
//   players' buttons ~50 times a second as "G1,B1,L1,R1,G2,B2,L2,R2".
//
// LIBRARY TO INSTALL (once, in the Arduino IDE):
//   Sketch > Include Library > Manage Libraries... > search "WebSockets"
//   (by Markus Sattler / links2004) > Install
//
// Wiring (same as the other versions):
// - One leg of every button to its GPIO, the other leg to GND.
// - No external resistors, the internal pull-ups are used.
//
//   PLAYER 1 (arrow keys in the browser)
//   GAS   -> GPIO 32
//   BRAKE -> GPIO 33
//   LEFT  -> GPIO 25
//   RIGHT -> GPIO 26
//
//   PLAYER 2 (WASD in the browser)
//   GAS   -> GPIO 27
//   BRAKE -> GPIO 14
//   LEFT  -> GPIO 13
//   RIGHT -> GPIO 4
//
// After uploading, open the Serial Monitor (115200 baud) - it prints whether
// the WiFi connection succeeded and the ESP32's IP address. Enter that IP
// address (e.g. 192.168.1.42) in the game's "Connect via WiFi" field. The
// name "driftcontroller.local" (mDNS) may work too if your system supports
// it - if not, just use the numeric IP address.

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ESPmDNS.h>

// ---- Your WiFi details live in secrets.h (git-ignored, never committed) ----
// First time: copy secrets.example.h to secrets.h in this folder and put
// your network name and password into it. The ESP32 only supports 2.4 GHz.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "secrets.h is missing: copy secrets.example.h to secrets.h (same folder) and fill in WIFI_SSID / WIFI_PASSWORD."
#endif

#if !defined(WIFI_SSID) || !defined(WIFI_PASSWORD)
#error "Set WIFI_SSID and WIFI_PASSWORD in secrets.h (and remove the // in front of them)."
#endif

const int PIN_P1_GAS   = 32;
const int PIN_P1_BRAKE = 33;
const int PIN_P1_LEFT  = 25;
const int PIN_P1_RIGHT = 26;

const int PIN_P2_GAS   = 27;
const int PIN_P2_BRAKE = 14;
const int PIN_P2_LEFT  = 13;
const int PIN_P2_RIGHT = 4;

const unsigned long SEND_INTERVAL_MS = 20;         // ~50 Hz
const unsigned long DEBUG_PRINT_INTERVAL_MS = 300; // Serial Monitor debug output rate
const unsigned long DEBOUNCE_MS = 15;

WebSocketsServer webSocket(81);
unsigned long lastSend = 0;
unsigned long lastDebugPrint = 0;

struct DebouncedButton {
  int pin;
  bool stableState;
  bool lastRead;
  unsigned long lastChangeMs;
};

// Order: P1 gas/brake/left/right, then P2 gas/brake/left/right.
DebouncedButton buttons[8] = {
  { PIN_P1_GAS,   false, false, 0 },
  { PIN_P1_BRAKE, false, false, 0 },
  { PIN_P1_LEFT,  false, false, 0 },
  { PIN_P1_RIGHT, false, false, 0 },
  { PIN_P2_GAS,   false, false, 0 },
  { PIN_P2_BRAKE, false, false, 0 },
  { PIN_P2_LEFT,  false, false, 0 },
  { PIN_P2_RIGHT, false, false, 0 },
};

void updateButton(DebouncedButton &b) {
  bool raw = (digitalRead(b.pin) == LOW); // LOW = pressed (pull-up)
  unsigned long now = millis();
  if (raw != b.lastRead) {
    b.lastChangeMs = now;
    b.lastRead = raw;
  }
  if ((now - b.lastChangeMs) > DEBOUNCE_MS) {
    b.stableState = raw;
  }
}

void onWebSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.printf("[WS] Game connected (client #%u)\n", num);
      break;
    case WStype_DISCONNECTED:
      Serial.printf("[WS] Game disconnected (client #%u)\n", num);
      break;
    default:
      break; // the controller only sends; incoming messages are ignored
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);

  for (int i = 0; i < 8; i++) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to the WiFi network");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Ready! The ESP32's IP address: ");
  Serial.println(WiFi.localIP());
  Serial.println("Enter this IP address in the game's WiFi controller field.");

  if (MDNS.begin("driftcontroller")) {
    Serial.println("mDNS started - you can also try 'driftcontroller.local'.");
  }

  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);
}

void loop() {
  webSocket.loop();

  for (int i = 0; i < 8; i++) {
    updateButton(buttons[i]);
  }

  unsigned long now = millis();
  // Counting the clients (instead of a single "connected" flag) keeps the
  // stream going when one of several connections closes.
  uint8_t clients = webSocket.connectedClients();

  // Debug: the button states are always printed to the Serial Monitor,
  // whether or not the game is connected, so the wiring / buttons can be
  // checked on their own.
  if (now - lastDebugPrint >= DEBUG_PRINT_INTERVAL_MS) {
    lastDebugPrint = now;
    Serial.printf("P1: GAS=%d BRAKE=%d LEFT=%d RIGHT=%d | P2: GAS=%d BRAKE=%d LEFT=%d RIGHT=%d | clients: %u\n",
      buttons[0].stableState ? 1 : 0,
      buttons[1].stableState ? 1 : 0,
      buttons[2].stableState ? 1 : 0,
      buttons[3].stableState ? 1 : 0,
      buttons[4].stableState ? 1 : 0,
      buttons[5].stableState ? 1 : 0,
      buttons[6].stableState ? 1 : 0,
      buttons[7].stableState ? 1 : 0,
      clients);
  }

  if (clients > 0 && (now - lastSend >= SEND_INTERVAL_MS)) {
    lastSend = now;
    char msg[32];
    snprintf(msg, sizeof(msg), "%d,%d,%d,%d,%d,%d,%d,%d",
      buttons[0].stableState ? 1 : 0,  // P1 GAS
      buttons[1].stableState ? 1 : 0,  // P1 BRAKE
      buttons[2].stableState ? 1 : 0,  // P1 LEFT
      buttons[3].stableState ? 1 : 0,  // P1 RIGHT
      buttons[4].stableState ? 1 : 0,  // P2 GAS
      buttons[5].stableState ? 1 : 0,  // P2 BRAKE
      buttons[6].stableState ? 1 : 0,  // P2 LEFT
      buttons[7].stableState ? 1 : 0); // P2 RIGHT
    webSocket.broadcastTXT(msg);
  }
}
