// Drift Game 2 - ESP32 controller firmware (WiFi access point version)
// ======================================================================
// 8 push buttons: 4 per player (GAS, BRAKE, LEFT, RIGHT). If you only play
// alone (Practice / 1 player), only player 1's 4 buttons need to be wired;
// player 2's inputs can stay unconnected (the game sees them as released).
//
// This version does NOT join any existing (router / home) WiFi network.
// Instead the ESP32 creates its own WiFi network ("access point") and your
// computer connects to it directly - just like connecting to a router.
// No shared external network is needed.
//
// NOTE: browsers only allow this plain ws:// connection when the game itself
// is served over http:// (e.g. locally with start.bat). On an https:// site
// such as GitHub Pages use the USB firmware (drift_controller.ino).
//
// How it works:
// 1. After uploading, the ESP32 starts its own WiFi network (by default named
//    "DriftController" - set the name and password below).
// 2. On your computer, pick this network from the WiFi list and connect.
// 3. As an access point the ESP32 ALWAYS uses the fixed IP address
//    192.168.4.1 - enter it in the game's WiFi field.
// 4. The WebSocket server starts automatically; the game connects to it and
//    receives both players' buttons.
//
// IMPORTANT: while connected to the ESP32's network your computer has NO
// internet over that WiFi link (Windows may show "No internet" - that's
// normal, choose "Connect anyway" or just ignore it). If you need internet
// at the same time, use an Ethernet cable or a second WiFi adapter.
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

#include <WiFi.h>
#include <WebSocketsServer.h>

// ---- Name / password of the controller's own WiFi network ----
// CHANGE THE PASSWORD: the default one below is public (it is in this
// repository), and anyone on this network can read the button stream.
// It must be at least 8 characters long. For an open network (not
// recommended) use: const char* AP_PASSWORD = "";
const char* AP_SSID     = "DriftController";
const char* AP_PASSWORD = "drift1234";

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

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);

  Serial.println();
  Serial.println("=================================================");
  Serial.print("The ESP32's own WiFi network is up: ");
  Serial.println(AP_SSID);
  Serial.print("Connect your computer to this network, then enter this IP address in the game: ");
  Serial.println(WiFi.softAPIP()); // typically 192.168.4.1
  Serial.println("=================================================");

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
  // whether or not the game is connected. With a USB cable + Serial Monitor
  // you can check the wiring / buttons on their own before suspecting the
  // WiFi / browser side.
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
