// Drift Game 2 - ESP32 controller firmware (USB serial version)
// ==============================================================
// 8 push buttons: 4 per player (GAS, BRAKE, LEFT, RIGHT). If you only play
// alone (Practice / 1 player), only player 1's 4 buttons need to be wired.
//
// Use this version when the game runs on an HTTPS site (e.g. GitHub Pages):
// Web Serial works there, plain-WebSocket WiFi does not.
//
// Wiring:
// - One leg of every button goes to its GPIO, the other leg to GND.
// - No external resistors: the internal pull-ups are used (INPUT_PULLUP),
//   so pressed = LOW, released = HIGH.
//
// Default GPIO assignment (change the PIN_* constants below if needed):
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
// Protocol to the computer (USB serial, 115200 baud):
//   Every 20 ms one line: "G1,B1,L1,R1,G2,B2,L2,R2\n"
//   where every value is 0 or 1, e.g. "1,0,0,1,0,0,1,0\n"
//   (player 1: gas + right, player 2: left).
//
//   The browser game (src/input.js) reads it through the Web Serial API.
//   Select the port in the menu with "Connect controller (USB serial)"
//   (Chrome / Edge on a desktop only).
//
// Needed to upload (see docs/CONTROLLER_BUILD.md):
//   - Arduino IDE 2.x
//   - the "esp32" board package (Boards Manager, Espressif Systems)
//   - your ESP32 board selected under Tools > Board

const int PIN_P1_GAS   = 32;
const int PIN_P1_BRAKE = 33;
const int PIN_P1_LEFT  = 25;
const int PIN_P1_RIGHT = 26;

const int PIN_P2_GAS   = 27;
const int PIN_P2_BRAKE = 14;
const int PIN_P2_LEFT  = 13;
const int PIN_P2_RIGHT = 4;

const unsigned long SEND_INTERVAL_MS = 20; // ~50 Hz
unsigned long lastSend = 0;

// Simple debounce: a new state is only accepted once it has been stable
// for DEBOUNCE_MS (the button contacts don't bounce any more).
const unsigned long DEBOUNCE_MS = 15;

struct DebouncedButton {
  int pin;
  bool stableState;   // true = pressed
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

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 8; i++) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
  }
}

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

void loop() {
  for (int i = 0; i < 8; i++) {
    updateButton(buttons[i]);
  }

  unsigned long now = millis();
  if (now - lastSend >= SEND_INTERVAL_MS) {
    lastSend = now;
    for (int i = 0; i < 8; i++) {
      Serial.print(buttons[i].stableState ? 1 : 0);
      if (i < 7) Serial.print(',');
    }
    Serial.print('\n');
  }
}
