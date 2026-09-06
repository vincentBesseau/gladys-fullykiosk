// -----------------------------------------------------------------------------
// HTTP client for one tablet's Fully Kiosk REST API
// (http(s)://<ip>:<port>/?cmd=<cmd>&password=<password>&type=json[&...]).
//
// Also parses the "tablets" config field (see gladys-assistant-integration.json):
// one "ip[:port]:password" entry per line, used to know which password/port
// to use for a given tablet IP - the closest available substitute for a true
// per-device config field (Gladys external integrations only expose a flat,
// integration-wide config_schema - see docs/en.md).
// -----------------------------------------------------------------------------

import { DEFAULT_HTTP_PORT, FULLY_KIOSK_REST_TIMEOUT_MS, FULLY_CMD } from './constants.js';

/**
 * Parse the "tablets" config field into a lookup by IP.
 * @param {string} raw - Raw config value, one "ip[:port]:password" entry per line or comma.
 * @returns {Map<string, {port: number, password: string}>} Entries keyed by IP.
 * @example
 * parseTablets('192.168.1.50:secret\n192.168.1.51:2323:other');
 * // Map { '192.168.1.50' => { port: 2323, password: 'secret' }, '192.168.1.51' => { port: 2323, password: 'other' } }
 */
export function parseTablets(raw) {
  const map = new Map();
  if (!raw) {
    return map;
  }
  const lines = String(raw)
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const parts = line
      .split(':')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length < 2) {
      continue;
    }
    const [ip] = parts;
    const password = parts[parts.length - 1];
    const port = parts.length >= 3 ? Number(parts[1]) : DEFAULT_HTTP_PORT;
    if (!ip || !password || !Number.isFinite(port)) {
      continue;
    }
    map.set(ip, { port, password });
  }
  return map;
}

/**
 * Build the base URL of a tablet's REST server.
 * @param {object} target - `{ ip, port, useHttps }`.
 * @returns {string} The base URL, no trailing slash.
 */
function buildBaseUrl({ ip, port, useHttps }) {
  return `${useHttps ? 'https' : 'http'}://${ip}:${port}`;
}

/**
 * Send one command to a tablet's Fully Kiosk REST API.
 * @param {object} target - `{ ip, port, password, useHttps }`, as resolved by
 *   `resolveHttpTarget` in devices.js.
 * @param {string} cmd - One of the FULLY_CMD values.
 * @param {object} [params] - Extra query parameters the command needs (e.g. `{ url }`).
 * @returns {Promise<object>} The parsed JSON response (or `{ status: 'OK', raw }` if not JSON).
 * @example
 * await sendCommand(target, FULLY_CMD.SCREEN_ON);
 */
export async function sendCommand(target, cmd, params = {}) {
  const url = new URL(buildBaseUrl(target));
  url.searchParams.set('cmd', cmd);
  url.searchParams.set('password', target.password);
  url.searchParams.set('type', 'json');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FULLY_KIOSK_REST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${target.ip}: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { status: 'OK', raw: text };
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a tablet's full deviceInfo over HTTP - the on-demand fallback used by
 * onPoll, complementing the MQTT push (see docs/en.md).
 * @param {object} target - `{ ip, port, password, useHttps }`.
 * @returns {Promise<object>} The raw deviceInfo payload.
 * @example
 * const info = await getDeviceInfo(target);
 */
export async function getDeviceInfo(target) {
  return sendCommand(target, FULLY_CMD.DEVICE_INFO);
}
