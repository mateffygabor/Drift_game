import { t } from './i18n.js';

// Selectable vehicles. The `stats` multipliers scale the base CAR_TUNING
// values (1 = default):
//   topSpeed - top speed             accel   - acceleration
//   grip     - lateral grip          turn    - steering speed
//   drift    - how easily it slides out when braking in a corner
//   mass     - weight (in collisions the heavier car pushes the lighter one)
//   offroad  - 0..1, how little grass/sand slows it down (1 = not at all)
// `model` selects the 3D model, `engine` the engine sound character.
// The display name and description come from i18n.js (vehicle.<id>.name/desc).

export const VEHICLES = [
  {
    id: 'street',
    model: 'coupe',
    dims: { length: 45, width: 19 },
    stats: { topSpeed: 1.0, accel: 1.0, grip: 1.0, turn: 1.0, drift: 1.0, mass: 1.0, offroad: 0.1 },
    engine: { base: 48, range: 170, wave: 'sawtooth' },
  },
  {
    id: 'drift',
    model: 'jdm',
    dims: { length: 44, width: 18 },
    stats: { topSpeed: 0.96, accel: 1.02, grip: 0.8, turn: 1.25, drift: 1.4, mass: 0.92, offroad: 0.1 },
    engine: { base: 58, range: 210, wave: 'sawtooth' },
  },
  {
    id: 'muscle',
    model: 'muscle',
    dims: { length: 49, width: 20 },
    stats: { topSpeed: 1.1, accel: 1.25, grip: 0.76, turn: 0.86, drift: 1.2, mass: 1.35, offroad: 0.1 },
    engine: { base: 32, range: 120, wave: 'square' },
  },
  {
    id: 'rally',
    model: 'hatch',
    dims: { length: 40, width: 18 },
    stats: { topSpeed: 0.9, accel: 1.12, grip: 1.18, turn: 1.12, drift: 0.9, mass: 0.9, offroad: 0.8 },
    engine: { base: 55, range: 190, wave: 'sawtooth' },
  },
  {
    id: 'super',
    model: 'super',
    dims: { length: 46, width: 20 },
    stats: { topSpeed: 1.25, accel: 1.15, grip: 1.12, turn: 0.92, drift: 0.75, mass: 1.05, offroad: 0.0 },
    engine: { base: 62, range: 240, wave: 'sawtooth' },
  },
  {
    id: 'truck',
    model: 'pickup',
    dims: { length: 53, width: 21 },
    stats: { topSpeed: 0.86, accel: 0.88, grip: 0.92, turn: 0.82, drift: 1.0, mass: 1.9, offroad: 1.0 },
    engine: { base: 28, range: 95, wave: 'square' },
  },
  {
    id: 'kart',
    model: 'kart',
    dims: { length: 22, width: 14 },
    stats: { topSpeed: 0.78, accel: 1.35, grip: 1.4, turn: 1.42, drift: 0.7, mass: 0.5, offroad: 0.2 },
    engine: { base: 85, range: 300, wave: 'square' },
  },
].map((v) => Object.defineProperties(v, {
  name: { get() { return t(`vehicle.${v.id}.name`); }, enumerable: true },
  desc: { get() { return t(`vehicle.${v.id}.desc`); }, enumerable: true },
}));

export const CAR_COLORS = [
  { id: 'red', hex: '#e8322a' },
  { id: 'blue', hex: '#2a7de8' },
  { id: 'yellow', hex: '#f2c230' },
  { id: 'green', hex: '#2fbf5a' },
  { id: 'orange', hex: '#ff7a1a' },
  { id: 'purple', hex: '#8a4be8' },
  { id: 'white', hex: '#eeeeee' },
  { id: 'black', hex: '#26262b' },
].map((c) => Object.defineProperty(c, 'name', { get() { return t(`color.${c.id}`); }, enumerable: true }));

// For the stat bars in the garage: [label, value 0..1]
export function statBars(v) {
  const s = v.stats;
  const norm = (x, lo, hi) => Math.max(0.05, Math.min(1, (x - lo) / (hi - lo)));
  return [
    [t('stat.topSpeed'), norm(s.topSpeed, 0.6, 1.3)],
    [t('stat.accel'), norm(s.accel, 0.7, 1.4)],
    [t('stat.grip'), norm(s.grip, 0.6, 1.45)],
    [t('stat.turn'), norm(s.turn, 0.7, 1.5)],
    [t('stat.drift'), norm(s.drift, 0.5, 1.45)],
    [t('stat.mass'), norm(s.mass, 0.3, 2.0)],
    [t('stat.offroad'), norm(s.offroad, -0.1, 1.0)],
  ];
}

export function getVehicleById(id) {
  return VEHICLES.find((v) => v.id === id) || VEHICLES[0];
}
