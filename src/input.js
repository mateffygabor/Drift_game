import { t } from './i18n.js';

// Unified input: merges the keyboard and the ESP32 controller (WiFi/WebSocket
// or USB serial) into one shared state for TWO players. The game only reads
// this state (inputState.p1 / inputState.p2), so it doesn't care where a
// command comes from.
//
// - Keyboard, USB and WiFi are separate sources; their states are OR-ed into
//   the final input, so none of them overwrites / clears another.
// - Dropout watchdog: if no data arrives for ~0.4 s the controller buttons
//   are released (no stuck gas / steering); after 2 s of silence the WiFi
//   link is reopened.
// - Automatic reconnect when the link drops.
// - Only ONE WiFi connection at a time: before reopening we wait for the old
//   one to close. (Older firmware used a single "client connected" flag, so
//   a late disconnect of the old link made the ESP32 stop sending.)
// - The link is closed cleanly when the page is closed / reloaded.

const FIELDS = ['gas', 'brake', 'left', 'right'];

function freshPlayerState() {
  return { gas: false, brake: false, left: false, right: false };
}

export const inputState = {
  p1: freshPlayerState(),
  p2: freshPlayerState(),
};

// State per source
const sources = {
  keyboard: { p1: freshPlayerState(), p2: freshPlayerState() },
  serial: { p1: freshPlayerState(), p2: freshPlayerState() },
  wifi: { p1: freshPlayerState(), p2: freshPlayerState() },
};

function recompute() {
  for (const p of ['p1', 'p2']) {
    for (const f of FIELDS) {
      inputState[p][f] = sources.keyboard[p][f] || sources.serial[p][f] || sources.wifi[p][f];
    }
  }
}

function resetSource(name) {
  Object.assign(sources[name].p1, freshPlayerState());
  Object.assign(sources[name].p2, freshPlayerState());
  recompute();
}

// ---- Keyboard ----
// Player 1 drives with the arrow keys, player 2 with WASD.
const KEY_MAP_P1 = {
  ArrowUp: 'gas',
  ArrowDown: 'brake',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};
const KEY_MAP_P2 = {
  KeyW: 'gas',
  KeyS: 'brake',
  KeyA: 'left',
  KeyD: 'right',
};

function initKeyboard() {
  const kb = sources.keyboard;
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') return; // not while typing
    const f1 = KEY_MAP_P1[e.code];
    const f2 = KEY_MAP_P2[e.code];
    if (f1) { kb.p1[f1] = true; e.preventDefault(); }
    if (f2) { kb.p2[f2] = true; e.preventDefault(); }
    if (f1 || f2) recompute();
  });
  window.addEventListener('keyup', (e) => {
    const f1 = KEY_MAP_P1[e.code];
    const f2 = KEY_MAP_P2[e.code];
    if (f1) { kb.p1[f1] = false; e.preventDefault(); }
    if (f2) { kb.p2[f2] = false; e.preventDefault(); }
    if (f1 || f2) recompute();
  });
  // when the window loses focus no key may stay stuck (the controller is kept)
  window.addEventListener('blur', () => resetSource('keyboard'));
}

// Both controller links send the same text line "G1,B1,L1,R1,G2,B2,L2,R2"
// (player 1's buttons, then player 2's). Anything that isn't exactly eight
// 0/1 values is ignored. Returns whether the line was valid.
function applyControllerLine(line, sourceName) {
  if (!line || typeof line !== 'string') return false;
  const parts = line.trim().split(',').map((p) => p.trim());
  if (parts.length !== 8) return false;
  for (let i = 0; i < 8; i++) if (parts[i] !== '0' && parts[i] !== '1') return false;
  const src = sources[sourceName];
  const [g1, b1, l1, r1, g2, b2, l2, r2] = parts;
  src.p1.gas = g1 === '1';
  src.p1.brake = b1 === '1';
  src.p1.left = l1 === '1';
  src.p1.right = r1 === '1';
  src.p2.gas = g2 === '1';
  src.p2.brake = b2 === '1';
  src.p2.left = l2 === '1';
  src.p2.right = r2 === '1';
  recompute();
  return true;
}

// ---- ESP32 controller over USB (Web Serial) ----
// Protocol: about 50 times a second the ESP32 sends a text line
// "G1,B1,L1,R1,G2,B2,L2,R2\n". See esp32/drift_controller/drift_controller.ino
//
// - After opening the port the ESP32 is restarted into "run" mode (the same
//   way the Arduino IDE / esptool does it): on most ESP32 boards DTR/RTS are
//   wired to the reset and boot pins, and opening the port can leave the board
//   stuck in download (bootloader) mode - then no data arrives at all.
// - A read error (e.g. boot-message garbage, buffer overrun) doesn't drop the
//   link: Web Serial provides a new stream and we keep reading.
// - On disconnect the port is really closed, so it can be reopened.
// - Dropout watchdog (against stuck buttons), automatic handling of
//   unplug / replug, and after a page reload the previously permitted port is
//   reopened automatically.
const SERIAL_AUTO_KEY = 'driftgame2_serial_auto';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// States: 'idle' | 'connecting' | 'waiting' | 'connected' | 'stalled' |
//         'nodata' | 'busy' | 'unplugged' | 'error'
class SerialController {
  constructor() {
    this.port = null;
    this.open = false;
    this.connected = false;
    this.wanted = false;
    this.state = 'idle';
    this.onStatusChange = null; // (bool)
    this.onStateChange = null;  // (state)
    this.reader = null;
    this.lastDataAt = 0;
    this.openedAt = 0;
    this.resetTries = 0;
    this._watchdog = null;
    this._loopDone = null;

    if (!this.supported) return;
    // unplug / replug
    navigator.serial.addEventListener('disconnect', (e) => {
      if (e.target === this.port) {
        console.warn('[USB controller] The controller was unplugged.');
        this._close().then(() => this._setState(this.wanted ? 'unplugged' : 'idle'));
      }
    });
    navigator.serial.addEventListener('connect', (e) => {
      if (this.wanted && !this.open && this._matches(e.target)) {
        console.log('[USB controller] Plugged back in - reopening.');
        this._openPort(e.target);
      }
    });
    window.addEventListener('pagehide', () => { this.wanted = false; this._close(); });
  }

  get supported() {
    return 'serial' in navigator;
  }

  _matches(port) {
    try {
      const saved = JSON.parse(localStorage.getItem(SERIAL_AUTO_KEY) || 'null');
      if (!saved) return true;
      const info = port.getInfo();
      return info.usbVendorId === saved.usbVendorId && info.usbProductId === saved.usbProductId;
    } catch { return true; }
  }

  // On page load: if a previously permitted port is available, reopen it.
  async autoReconnect() {
    if (!this.supported) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SERIAL_AUTO_KEY) || 'null'); } catch { /* ignore */ }
    if (!saved) return;
    const ports = await navigator.serial.getPorts();
    const port = ports.find((p) => this._matches(p));
    if (!port) return;
    this.wanted = true;
    console.log('[USB controller] Previously used port found - connecting automatically.');
    await this._openPort(port);
  }

  async connect() {
    if (!this.supported) {
      alert(t('usb.unsupportedAlert'));
      return false;
    }
    let port;
    try {
      port = await navigator.serial.requestPort();
    } catch (err) {
      console.warn('[USB controller] Port selection cancelled:', err);
      return false;
    }
    this.wanted = true;
    try {
      const info = port.getInfo();
      localStorage.setItem(SERIAL_AUTO_KEY, JSON.stringify({ usbVendorId: info.usbVendorId, usbProductId: info.usbProductId }));
    } catch { /* ignore */ }
    return this._openPort(port);
  }

  async disconnect() {
    this.wanted = false;
    try { localStorage.removeItem(SERIAL_AUTO_KEY); } catch { /* ignore */ }
    await this._close();
    this._setState('idle');
  }

  async _openPort(port) {
    if (this.open || this.port) await this._close();
    this.port = port;
    this._setState('connecting');
    try {
      await port.open({ baudRate: 115200, bufferSize: 8192 });
    } catch (err) {
      // if it was left open by an earlier (broken) connection, close it and retry
      if (err.name === 'InvalidStateError') {
        try { await port.close(); await port.open({ baudRate: 115200, bufferSize: 8192 }); } catch (err2) { return this._openFailed(err2); }
      } else {
        return this._openFailed(err);
      }
    }
    this.open = true;
    this.resetTries = 0;
    await this._resetIntoRunMode();
    this.openedAt = performance.now();
    this.lastDataAt = 0;
    this._setState('waiting');
    clearInterval(this._watchdog);
    this._watchdog = setInterval(() => this._check(), 100);
    this._loopDone = this._readLoop(port);
    return true;
  }

  _openFailed(err) {
    console.warn('[USB controller] Could not open the port:', err);
    this.port = null;
    // typically the Arduino IDE Serial Monitor (or another tab) holds the port
    this._setState(err && err.name === 'NetworkError' ? 'busy' : 'error');
    return false;
  }

  // Restart the ESP32 in normal run mode (pull EN low briefly, IO0 high):
  // DTR=false (IO0 high), RTS=true (reset) -> RTS=false (boot).
  async _resetIntoRunMode() {
    try {
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await sleep(120);
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      console.log('[USB controller] ESP32 restarted in run mode, waiting for data...');
    } catch (err) {
      console.warn('[USB controller] Could not set the reset signals (fine if the board sends anyway):', err);
    }
  }

  async _readLoop(port) {
    const decoder = new TextDecoder();
    let buffer = '';
    while (this.open && this.port === port && port.readable) {
      let reader;
      try {
        reader = port.readable.getReader();
      } catch (err) {
        console.warn('[USB controller] The port is not readable:', err);
        break;
      }
      this.reader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (applyControllerLine(line, 'serial')) {
              this.lastDataAt = performance.now();
              if (this.state !== 'connected') {
                if (this.state === 'waiting' || this.state === 'nodata') console.log('[USB controller] Data is arriving:', line);
                this._setState('connected');
              }
            }
          }
          if (buffer.length > 512) buffer = buffer.slice(-64); // against garbage (e.g. boot messages)
        }
      } catch (err) {
        // non-fatal error (e.g. BufferOverrunError, FramingError, BreakError): keep reading
        console.warn(`[USB controller] Read error (${err.name}), continuing.`);
        buffer = '';
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
        this.reader = null;
      }
      if (this.open && this.port === port) await sleep(20);
    }
    // if we didn't close it, the device is gone
    if (this.open && this.port === port) {
      console.warn('[USB controller] The port was lost.');
      await this._close();
      this._setState(this.wanted ? 'unplugged' : 'idle');
    }
  }

  _check() {
    if (!this.open) return;
    const now = performance.now();
    if (this.lastDataAt) {
      if (now - this.lastDataAt > 400) {
        resetSource('serial'); // nothing may stay pressed
        if (this.state === 'connected') this._setState('stalled');
      }
      return;
    }
    // not a single valid line has arrived yet
    const since = now - this.openedAt;
    if (since > 2500 && this.resetTries === 0) {
      this.resetTries = 1;
      console.warn('[USB controller] No data within 2.5 s - restarting the ESP32 once more.');
      this._resetIntoRunMode();
      this.openedAt = now - 2600; // keep counting towards the next check
    } else if (since > 6000 && this.state !== 'nodata') {
      console.warn('[USB controller] No data. Check that the USB firmware (drift_controller.ino) is on the board and the Arduino Serial Monitor is closed.');
      this._setState('nodata');
    }
  }

  async _close() {
    const port = this.port;
    this.open = false;
    clearInterval(this._watchdog);
    resetSource('serial');
    if (this.reader) { try { await this.reader.cancel(); } catch { /* ignore */ } }
    if (this._loopDone) { try { await Promise.race([this._loopDone, sleep(500)]); } catch { /* ignore */ } }
    this._loopDone = null;
    if (port) {
      for (let i = 0; i < 10; i++) {
        try { await port.close(); break; } catch (err) {
          if (err.name === 'InvalidStateError' && !port.readable) break; // already closed
          await sleep(30);
        }
      }
    }
    this.port = null;
  }

  _setState(state) {
    const prev = this.state;
    this.state = state;
    const on = state === 'connected' || state === 'stalled';
    if (on !== this.connected) {
      this.connected = on;
      if (this.onStatusChange) this.onStatusChange(on);
    }
    if (prev !== state && this.onStateChange) this.onStateChange(state);
  }
}

export const serialController = new SerialController();

// ---- ESP32 controller over WiFi (WebSocket) ----
// The ESP32 runs a WebSocket server on port 81 and sends the
// "G1,B1,L1,R1,G2,B2,L2,R2" message ~50 times a second.
// See esp32/drift_controller_wifi_ap/
const WIFI_LAST_HOST_KEY = 'driftgame_last_controller_host';

const STALE_MS = 400;        // release the buttons after this much silence
const DEAD_MS = 2000;        // reopen the connection after this much silence
const CONNECT_TIMEOUT_MS = 4000;
const CLOSE_WAIT_MS = 800;   // how long to wait for the old connection to close
const RETRY_DELAYS = [300, 700, 1500, 3000];

// Accepts a plain host name or IPv4 address (an optional "ws://" prefix,
// ":81" port and trailing "/" are tolerated and stripped). Returns the clean
// host, or null - so nothing can inject a path, port or another scheme into
// the WebSocket URL.
const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_RE = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*$`);
export function normalizeControllerHost(input) {
  const h = String(input || '').trim().toLowerCase()
    .replace(/^wss?:\/\//, '').replace(/\/+$/, '').replace(/:81$/, '');
  if (!h || h.length > 253) return null;
  return HOST_RE.test(h) ? h : null;
}

// Browsers block plain ws:// connections from https:// pages (mixed
// content), except to localhost. The ESP32 can't do TLS, so on an HTTPS site
// (e.g. GitHub Pages) only the USB controller works.
function wifiBlockedByHttps(host) {
  if (location.protocol !== 'https:') return false;
  return !(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost'));
}

// States: 'idle' | 'connecting' | 'waiting' (open, no data yet) |
//         'connected' | 'stalled' (open, but no data) | 'reconnecting' |
//         'badhost' (invalid address) | 'insecure' (blocked on an HTTPS page)
class WifiController {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.state = 'idle';
    this.host = '';
    this.wanted = false;       // the user wants to be connected (for auto-reconnect)
    this.onStatusChange = null; // (bool) connected or not
    this.onStateChange = null;  // (state) detailed state for the UI
    this.lastMessageAt = 0;
    this.messageCount = 0;
    this.retry = 0;
    this.reconnects = 0;
    this._timers = { connect: null, retry: null, watchdog: null };

    // close cleanly when the page is closed / reloaded, so the ESP32 learns
    // about it immediately (otherwise the old link would "disconnect" later)
    window.addEventListener('pagehide', () => {
      this.wanted = false;
      if (this.ws) { try { this.ws.close(1000); } catch { /* ignore */ } }
    });
  }

  get lastHost() {
    try { return localStorage.getItem(WIFI_LAST_HOST_KEY) || ''; } catch { return ''; }
  }

  connect(host) {
    const target = normalizeControllerHost(host);
    if (!target) {
      this.disconnect();
      this._setState('badhost');
      return false;
    }
    try { localStorage.setItem(WIFI_LAST_HOST_KEY, target); } catch { /* ignore */ }
    if (wifiBlockedByHttps(target)) {
      this.disconnect();
      this._setState('insecure');
      return false;
    }
    this.host = target;
    this.wanted = true;
    this.retry = 0;
    clearTimeout(this._timers.retry);
    this._reopen();
    return true;
  }

  disconnect() {
    this.wanted = false;
    this._clearTimers();
    const old = this.ws;
    this.ws = null;
    if (old) { this._detach(old); try { old.close(1000); } catch { /* ignore */ } }
    resetSource('wifi');
    this._setState('idle');
  }

  _clearTimers() {
    clearTimeout(this._timers.connect);
    clearTimeout(this._timers.retry);
    clearInterval(this._timers.watchdog);
  }

  _detach(ws) {
    ws.onopen = null; ws.onmessage = null; ws.onerror = null;
  }

  // Open a new connection - but only AFTER the old one has closed (or the wait timed out).
  _reopen() {
    this._clearTimers();
    resetSource('wifi');
    const old = this.ws;
    this.ws = null;
    if (!old || old.readyState === WebSocket.CLOSED) { this._open(); return; }
    this._detach(old);
    let opened = false;
    const openOnce = () => { if (!opened) { opened = true; if (this.wanted) this._open(); } };
    old.onclose = openOnce;
    try { old.close(1000); } catch { /* ignore */ }
    this._timers.retry = setTimeout(openOnce, CLOSE_WAIT_MS);
  }

  _open() {
    if (!this.wanted) return;
    let ws;
    try {
      ws = new WebSocket(`ws://${this.host}:81/`);
    } catch (err) {
      // a SecurityError (mixed content) won't go away by retrying
      console.warn('[WiFi controller] Could not open the connection:', err);
      if (err && err.name === 'SecurityError') {
        this.wanted = false;
        this._setState('insecure');
      } else {
        this._scheduleRetry();
      }
      return;
    }
    this.ws = ws;
    this.messageCount = 0;
    this._setState(this.retry > 0 ? 'reconnecting' : 'connecting');
    console.log(`[WiFi controller] Connecting: ws://${this.host}:81/ (attempt ${this.retry + 1})`);

    this._timers.connect = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) {
        console.warn('[WiFi controller] Could not connect in time, retrying...');
        this._detach(ws);
        ws.onclose = null;
        try { ws.close(); } catch { /* ignore */ }
        this.ws = null;
        this._scheduleRetry();
      }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      clearTimeout(this._timers.connect);
      this.lastMessageAt = performance.now();
      this._setState('waiting');
      console.log('[WiFi controller] Connected, waiting for data...');
      clearInterval(this._timers.watchdog);
      this._timers.watchdog = setInterval(() => this._watchdog(), 100);
    };
    ws.onmessage = (evt) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = performance.now();
      this.messageCount++;
      if (!applyControllerLine(evt.data, 'wifi')) return;
      if (this.state !== 'connected') {
        this.retry = 0;
        this._setState('connected');
        if (this.messageCount === 1) console.log('[WiFi controller] First data received:', evt.data);
      }
    };
    ws.onerror = () => {
      // details are in the browser console; onclose handles the cleanup
    };
    ws.onclose = (evt) => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearTimeout(this._timers.connect);
      clearInterval(this._timers.watchdog);
      resetSource('wifi');
      console.warn(`[WiFi controller] Connection closed (code ${evt.code}).`);
      if (this.wanted) this._scheduleRetry(); else this._setState('idle');
    };
  }

  _watchdog() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const silent = performance.now() - this.lastMessageAt;
    if (silent > STALE_MS && (this.state === 'connected' || this.state === 'waiting')) {
      // gas / steering must not stay stuck until fresh data arrives
      resetSource('wifi');
      if (this.state === 'connected') {
        console.warn('[WiFi controller] Data dropout - buttons released, waiting...');
        this._setState('stalled');
      }
    }
    if (silent > DEAD_MS) {
      console.warn('[WiFi controller] No data for 2 seconds - reopening the connection.');
      this.reconnects++;
      this.retry = Math.max(this.retry, 1);
      this._setState('reconnecting');
      this._reopen();
    }
  }

  _scheduleRetry() {
    if (!this.wanted) return;
    const delay = RETRY_DELAYS[Math.min(this.retry, RETRY_DELAYS.length - 1)];
    this.retry++;
    this.reconnects++;
    this._setState('reconnecting');
    clearTimeout(this._timers.retry);
    this._timers.retry = setTimeout(() => this._reopen(), delay);
  }

  _setState(state) {
    const prev = this.state;
    this.state = state;
    const on = state === 'connected' || state === 'stalled';
    if (on !== this.connected) {
      this.connected = on;
      if (this.onStatusChange) this.onStatusChange(on);
    }
    if (prev !== state && this.onStateChange) this.onStateChange(state);
  }
}

export const wifiController = new WifiController();

export function initInput() {
  initKeyboard();
}
