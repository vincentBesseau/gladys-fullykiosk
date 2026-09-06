// -----------------------------------------------------------------------------
// Per-tablet REST API credentials, set via the "set_tablet_password" manifest
// action (a device picker - populated by Gladys from the integration's
// already-created devices, source: "devices" - plus a password and an
// optional port). Stored as a JSON blob under one off-schema config key
// (CONFIG_KEYS.TABLET_CREDENTIALS), keyed by the device's own external_id
// rather than its IP: the external_id is stable, unlike a DHCP-assigned IP
// that can change over time.
// -----------------------------------------------------------------------------

import { CONFIG_KEYS } from './constants.js';

/**
 * Parse the stored tablet-credentials JSON blob.
 * @param {string|undefined} raw - The raw config value.
 * @returns {Record<string, {password: string, port?: number}>} The credentials, keyed by device external_id.
 * @example
 * parseTabletCredentials('{"ext:sel:fullykiosk:abc":{"password":"x"}}');
 */
export function parseTabletCredentials(raw) {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Read one tablet's stored REST API credentials.
 * @param {object} config - The integration config (gladys.getConfig()).
 * @param {string} deviceExternalId - The Gladys device external_id.
 * @returns {{password: string, port?: number}|undefined} The credentials, or undefined if none are set.
 * @example
 * const credential = getTabletCredential(config, device.external_id);
 */
export function getTabletCredential(config, deviceExternalId) {
  return parseTabletCredentials(config[CONFIG_KEYS.TABLET_CREDENTIALS])[deviceExternalId];
}

/**
 * Save one tablet's REST API credentials (merged into the existing map).
 * @param {object} gladys - The Gladys SDK instance.
 * @param {string} deviceExternalId - The Gladys device external_id.
 * @param {{password: string, port?: number}} credential - The credentials to store.
 * @returns {Promise<void>} Resolves once persisted.
 * @example
 * await setTabletCredential(gladys, device.external_id, { password: 'secret' });
 */
export async function setTabletCredential(gladys, deviceExternalId, credential) {
  const config = (await gladys.getConfig()) || {};
  const all = parseTabletCredentials(config[CONFIG_KEYS.TABLET_CREDENTIALS]);
  all[deviceExternalId] = credential;
  await gladys.setConfig({ [CONFIG_KEYS.TABLET_CREDENTIALS]: JSON.stringify(all) });
}
