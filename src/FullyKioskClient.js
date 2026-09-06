// -----------------------------------------------------------------------------
// HTTP client for one tablet's Fully Kiosk REST API
// (http(s)://<ip>:<port>/?cmd=<cmd>&password=<password>&type=json[&...]).
//
// The password/port for a given tablet come from src/tabletCredentials.js
// (set via the "set_tablet_password" manifest action), resolved together
// with the tablet's MQTT-learned IP by resolveHttpTarget in devices.js.
// -----------------------------------------------------------------------------

import { FULLY_KIOSK_REST_TIMEOUT_MS, FULLY_CMD } from './constants.js';

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
