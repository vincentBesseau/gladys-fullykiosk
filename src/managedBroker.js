// -----------------------------------------------------------------------------
// "Managed broker" mode: this integration can run its own Mosquitto MQTT
// broker as a manifest sub-container (see the `containers` field of
// gladys-assistant-integration.json) instead of requiring the user to already
// have one. Credentials are generated once (random, integration-owned) and
// persisted OUTSIDE config_schema (see CONFIG_KEYS in constants.js - never
// shown in the standard form, never typed by the user).
//
// Why this container WRITES the sub-container's config/password file itself
// (rather than letting the sub-container run `mosquitto_passwd` on its own
// first boot, which is the more obvious design): Gladys runs every
// sub-container with every Linux capability dropped (`CapDrop: ["ALL"]`) and
// `no-new-privileges` - confirmed empirically against a real Gladys instance.
// Under that policy a container-root process fails normal DAC permission
// checks like a regular user (no CAP_DAC_OVERRIDE/CAP_CHOWN/CAP_SETUID), so
// mosquitto_passwd cannot create a file in the bind-mounted volume, and
// mosquitto itself cannot drop privileges internally either. This
// container's OWN filesystem UID (1000) is exactly the UID Gladys uses to
// pre-create every sub-container volume folder (server/lib/external-integration
// /externalIntegration.ensureSubContainerVolumes.js), and its /data is
// bind-mounted from the SAME host folder the sub-container's volumes are
// carved out of (server/.../externalIntegration.buildSubContainerDescriptor.js:
// the main container sees them under `/data/containers/<name>/...`) - so
// writing the password file from here, as this container's own uid, is the
// one path that is actually writable. The password hash itself reimplements
// Mosquitto's own "$7$" PBKDF2-SHA512 scheme (see buildMosquittoPasswordHash)
// rather than shelling out to `mosquitto_passwd`, which this image does not
// bundle - verified byte-for-byte interchangeable with the real tool's own
// output (round-tripped through a real mosquitto broker: a hash generated
// here authenticates a client and a wrong password is rejected, both with
// and without the sub-container's capabilities dropped, as of mosquitto
// 2.0.18 - see git history for the manual verification).
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import fs from 'node:fs';
import { CONFIG_KEYS, MANAGED_BROKER } from './constants.js';

// PBKDF2 iteration count Mosquitto 2.x itself uses by default for its "$7$"
// password scheme (confirmed by inspecting real `mosquitto_passwd` output -
// low by modern PBKDF2 standards, but this is Mosquitto's own compiled-in
// default, not a choice made here; the value must match exactly for
// Mosquitto to accept the hash).
const MOSQUITTO_PBKDF2_ITERATIONS = 101;
const MOSQUITTO_SALT_BYTES = 12;
const MOSQUITTO_HASH_BYTES = 64;

// Where this container's own /data maps to the managed broker sub-container's
// declared volumes (see the file header for why).
const MOSQUITTO_CONFIG_DIR = '/data/containers/mosquitto/mosquitto/config';

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
 * Build one line of a Mosquitto "$7$" (PBKDF2-SHA512) password file for the
 * given username/password - see the file header for why this is
 * reimplemented instead of shelling out to `mosquitto_passwd`. A fresh
 * random salt is used every call: verifying a password never needs the same
 * hash string twice, so this does not need to be deterministic.
 * @param {string} username - The MQTT username.
 * @param {string} password - The MQTT password, in clear.
 * @returns {string} One password-file line: `username:$7$iterations$salt$hash`.
 * @example
 * buildMosquittoPasswordEntry('fullykiosk', 'secret');
 * // 'fullykiosk:$7$101$<base64 salt>$<base64 hash>'
 */
export function buildMosquittoPasswordEntry(username, password) {
  const salt = crypto.randomBytes(MOSQUITTO_SALT_BYTES);
  const hash = crypto.pbkdf2Sync(
    password,
    salt,
    MOSQUITTO_PBKDF2_ITERATIONS,
    MOSQUITTO_HASH_BYTES,
    'sha512',
  );
  return `${username}:$7$${MOSQUITTO_PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Build the managed broker's mosquitto.conf content.
 * `user root`: without it Mosquitto tries to drop privileges to its own
 * internal default user, which needs CAP_SETUID/CAP_SETGID - unavailable
 * under Gladys' sub-container policy (see the file header) and fatal to
 * startup ("Error setting groups whilst dropping privileges") without this.
 * @returns {string} The mosquitto.conf content.
 * @example
 * fs.writeFileSync(path, buildMosquittoConfContent());
 */
export function buildMosquittoConfContent() {
  return [
    'user root',
    'listener 1883',
    'allow_anonymous false',
    'password_file /mosquitto/config/passwd',
    // No persistence, no file logging: /mosquitto/data and /mosquitto/log are
    // owned by this container's uid (see the file header), which the broker
    // process cannot write into under Gladys' capabilities-dropped policy -
    // confirmed live (recurring "Permission denied" every autosave_interval,
    // and the log file itself failing to open at startup). stdout is
    // collected by `docker logs` regardless of file permissions, and nothing
    // in this integration relies on the broker surviving its own restart
    // with retained state (Fully Kiosk re-publishes deviceInfo on its own).
    'persistence false',
    'log_dest stdout',
    '',
  ].join('\n');
}

/**
 * Write the managed broker's mosquitto.conf and password file, from this
 * container's own /data mount (see the file header for the path mapping).
 * World-readable (0o644) is required for the sub-container to read it back:
 * it runs under a different, unrelated uid (see the file header), so this
 * container - the file's only possible writer - cannot chown it to align
 * ownership instead.
 * @param {string} username - The MQTT username.
 * @param {string} password - The MQTT password, in clear.
 * @param {string} [configDir] - Override of the config directory (tests only;
 *   production always uses MOSQUITTO_CONFIG_DIR).
 * @returns {void}
 * @example
 * writeManagedBrokerConfig('fullykiosk', 'secret');
 */
export function writeManagedBrokerConfig(username, password, configDir = MOSQUITTO_CONFIG_DIR) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(`${configDir}/mosquitto.conf`, buildMosquittoConfContent(), {
    mode: 0o644,
  });
  fs.writeFileSync(`${configDir}/passwd`, `${buildMosquittoPasswordEntry(username, password)}\n`, {
    mode: 0o644,
  });
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
