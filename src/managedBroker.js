// -----------------------------------------------------------------------------
// "Managed broker" mode: this integration can run its own Mosquitto MQTT
// broker as a manifest sub-container (see the `containers` field of
// gladys-assistant-integration.json) instead of requiring the user to already
// have one. Credentials are generated once (random, integration-owned) and
// persisted OUTSIDE config_schema (see CONFIG_KEYS in constants.js - never
// shown in the standard form, never typed by the user), then handed to the
// sub-container at start time through POST /container/:name/start's `env`
// (see gladys.startContainer) - never baked into the manifest itself, which
// is public.
//
// The sub-container's own startup command (see the manifest) runs
// `mosquitto_passwd` itself, from those env vars, to produce its password
// file - this integration never reimplements Mosquitto's password hashing.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import { CONFIG_KEYS, MANAGED_BROKER } from './constants.js';

/**
 * Generate a fresh set of managed-broker credentials. The password is
 * URL-safe base64 (A-Z a-z 0-9 - _ only): safe to interpolate into the
 * sub-container's shell startup command with no quoting/escaping concerns.
 * @returns {{username: string, password: string}} The generated credentials.
 * @example
 * const { username, password } = generateManagedBrokerCredentials();
 */
export function generateManagedBrokerCredentials() {
  return {
    username: 'fullykiosk',
    password: crypto.randomBytes(24).toString('base64url'),
  };
}

/**
 * Read the managed-broker credentials from config, generating and persisting
 * them on first use (idempotent - later calls return the same credentials).
 * @param {object} gladys - The Gladys SDK instance.
 * @returns {Promise<{username: string, password: string}>} The credentials.
 * @example
 * const creds = await ensureManagedBrokerCredentials(gladys);
 */
export async function ensureManagedBrokerCredentials(gladys) {
  const config = (await gladys.getConfig()) || {};
  const existingUsername = config[CONFIG_KEYS.MANAGED_BROKER_USERNAME];
  const existingPassword = config[CONFIG_KEYS.MANAGED_BROKER_PASSWORD];
  if (existingUsername && existingPassword) {
    return { username: existingUsername, password: existingPassword };
  }
  const generated = generateManagedBrokerCredentials();
  await gladys.setConfig({
    [CONFIG_KEYS.MANAGED_BROKER_USERNAME]: generated.username,
    [CONFIG_KEYS.MANAGED_BROKER_PASSWORD]: generated.password,
  });
  return generated;
}

/**
 * Find the host port Gladys assigned to the managed broker's published MQTT
 * port, from a GET /container listing.
 * @param {Array<object>} containers - The result of gladys.getContainers().
 * @returns {number|null} The host port, or null if not started/assigned yet.
 * @example
 * const port = findManagedBrokerHostPort(await gladys.getContainers());
 */
export function findManagedBrokerHostPort(containers) {
  const container = (containers || []).find((c) => c.name === MANAGED_BROKER.CONTAINER_NAME);
  const port = (container?.ports || []).find(
    (p) => p.container_port === MANAGED_BROKER.CONTAINER_PORT,
  );
  return port?.host_port ?? null;
}

/**
 * Build the multi-language message returned by the "show_broker_credentials"
 * action: what to type into each tablet's Fully Kiosk MQTT settings.
 * @param {object} params - `{ username, password, hostPort }` (hostPort may be null).
 * @returns {{en: string, fr: string}} The message.
 * @example
 * buildCredentialsMessage({ username: 'fullykiosk', password: 'xyz', hostPort: 41883 });
 */
export function buildCredentialsMessage({ username, password, hostPort }) {
  if (!hostPort) {
    return {
      en: 'The managed broker has not started yet - save the configuration with "Run a dedicated broker" selected, then try this action again in a few seconds.',
      fr: "Le broker dédié n'a pas encore démarré - enregistrez la configuration avec « Lancer un broker dédié » sélectionné, puis relancez cette action dans quelques secondes.",
    };
  }
  return {
    en: `In each tablet's Fully Kiosk MQTT settings, use: broker address "<your Gladys server's LAN IP>:${hostPort}", username "${username}", password "${password}".`,
    fr: `Dans les paramètres MQTT de chaque tablette Fully Kiosk, utilisez : adresse du broker « <IP LAN de votre serveur Gladys>:${hostPort} », identifiant « ${username} », mot de passe « ${password} ».`,
  };
}
