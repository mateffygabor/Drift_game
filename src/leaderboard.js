// Top 10 lap times per track, stored in the browser's localStorage.
// Note: this is per browser / per computer - there is no server or cloud.
// Everything read back is validated, so a corrupted or hand-edited entry
// can't break the menu.

import { getVehicleById } from './vehicles.js';

const STORAGE_KEY = 'driftgame2_leaderboard';
const NAME_KEY = 'driftgame_last_name';
const MAX_ENTRIES = 10;
const MAX_NAME = 12;

function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const timeMs = Number(e.timeMs);
  if (!Number.isFinite(timeMs) || timeMs <= 0) return null;
  return {
    name: typeof e.name === 'string' ? e.name.slice(0, MAX_NAME) : '',
    timeMs,
    vehicleId: typeof e.vehicleId === 'string' ? e.vehicleId : null,
    vehicle: typeof e.vehicle === 'string' ? e.vehicle.slice(0, 40) : '', // older saves stored the display name
    date: typeof e.date === 'string' ? e.date : '',
  };
}

function loadAll() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (err) {
    console.warn('Could not load the leaderboard, starting empty:', err);
    return {};
  }
}

function saveAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Could not save the leaderboard:', err);
  }
}

export function getTimes(trackId) {
  const list = loadAll()[trackId];
  if (!Array.isArray(list)) return [];
  return list.map(cleanEntry).filter(Boolean).sort((a, b) => a.timeMs - b.timeMs).slice(0, MAX_ENTRIES);
}

// Display name of the vehicle of an entry, in the current language.
export function entryVehicleName(e) {
  return e.vehicleId ? getVehicleById(e.vehicleId).name : e.vehicle;
}

// Whether a new time would make it into the top 10.
export function wouldQualify(trackId, timeMs) {
  const list = getTimes(trackId);
  if (list.length < MAX_ENTRIES) return true;
  return timeMs < list[list.length - 1].timeMs;
}

export function addTime(trackId, name, timeMs, vehicleId = null) {
  const all = loadAll();
  const list = getTimes(trackId);
  list.push({ name: String(name || '').slice(0, MAX_NAME), timeMs, vehicleId, vehicle: '', date: new Date().toISOString() });
  list.sort((a, b) => a.timeMs - b.timeMs);
  all[trackId] = list.slice(0, MAX_ENTRIES);
  saveAll(all);
  return all[trackId];
}

export function getLastPlayerName() {
  try {
    return (localStorage.getItem(NAME_KEY) || '').slice(0, MAX_NAME);
  } catch {
    return '';
  }
}

export function setLastPlayerName(name) {
  try {
    localStorage.setItem(NAME_KEY, String(name).slice(0, MAX_NAME));
  } catch { /* ignore */ }
}

export function formatTime(ms) {
  if (ms == null || !isFinite(ms)) return '--:--.---';
  // round to whole ms first, otherwise 59.9996 s would show as "0:60.000"
  const total = Math.max(0, Math.round(ms));
  const min = Math.floor(total / 60000);
  const sec = (total - min * 60000) / 1000;
  return `${min}:${sec.toFixed(3).padStart(6, '0')}`;
}
