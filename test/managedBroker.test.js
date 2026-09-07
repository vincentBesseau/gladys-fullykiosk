import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  generateManagedBrokerCredentials,
  ensureManagedBrokerCredentials,
  findManagedBrokerHostPort,
  buildCredentialsMessage,
  buildMosquittoPasswordEntry,
  buildMosquittoConfContent,
  writeManagedBrokerConfig,
} from '../src/managedBroker.js';

describe('generateManagedBrokerCredentials', () => {
  test('generates a URL-safe base64 password with no shell-unsafe characters', () => {
    const { username, password } = generateManagedBrokerCredentials();
    assert.equal(username, 'fullykiosk');
    assert.match(password, /^[A-Za-z0-9_-]+$/);
    assert.ok(password.length >= 24);
  });

  test('generates a different password each time', () => {
    const a = generateManagedBrokerCredentials();
    const b = generateManagedBrokerCredentials();
    assert.notEqual(a.password, b.password);
  });
});

describe('ensureManagedBrokerCredentials', () => {
  test('generates and persists credentials on first use', async () => {
    const gladys = createFakeGladys();
    const creds = await ensureManagedBrokerCredentials(gladys);
    assert.equal(creds.username, 'fullykiosk');
    assert.ok(creds.password);

    const config = await gladys.getConfig();
    assert.equal(config.managed_broker_username, creds.username);
    assert.equal(config.managed_broker_password, creds.password);
  });

  test('returns the same credentials on a later call (idempotent)', async () => {
    const gladys = createFakeGladys();
    const first = await ensureManagedBrokerCredentials(gladys);
    const second = await ensureManagedBrokerCredentials(gladys);
    assert.deepEqual(first, second);
  });

  test('reuses credentials already present in config', async () => {
    const gladys = createFakeGladys({
      config: { managed_broker_username: 'preset', managed_broker_password: 'secret' },
    });
    const creds = await ensureManagedBrokerCredentials(gladys);
    assert.deepEqual(creds, { username: 'preset', password: 'secret' });
  });
});

describe('findManagedBrokerHostPort', () => {
  test('finds the host port of the mosquitto container', () => {
    const containers = [{ name: 'mosquitto', ports: [{ container_port: 1883, host_port: 41883 }] }];
    assert.equal(findManagedBrokerHostPort(containers), 41883);
  });

  test('returns null when the container is not in the list', () => {
    assert.equal(findManagedBrokerHostPort([]), null);
  });

  test('returns null when the port has not been assigned yet', () => {
    const containers = [{ name: 'mosquitto', ports: [{ container_port: 1883, host_port: null }] }];
    assert.equal(findManagedBrokerHostPort(containers), null);
  });
});

describe('buildCredentialsMessage', () => {
  test('includes the username, password, host port and MQTT topic when available', () => {
    const message = buildCredentialsMessage({
      username: 'fullykiosk',
      password: 'secret123',
      hostPort: 41883,
      topicPrefix: 'fully',
    });
    assert.match(message.en, /fullykiosk/);
    assert.match(message.en, /secret123/);
    assert.match(message.en, /41883/);
    assert.match(message.en, /fully\/deviceInfo/);
    assert.match(message.fr, /fullykiosk/);
    assert.match(message.fr, /fully\/deviceInfo/);
  });

  test('explains the broker is not started yet when no host port is known', () => {
    const message = buildCredentialsMessage({
      username: 'x',
      password: 'y',
      hostPort: null,
      topicPrefix: 'fully',
    });
    assert.match(message.en, /not started yet/);
    assert.match(message.fr, /pas encore démarré/);
  });
});

describe('buildMosquittoPasswordEntry', () => {
  test('matches Mosquitto\'s "$7$<iterations>$<salt>$<hash>" format', () => {
    const entry = buildMosquittoPasswordEntry('fullykiosk', 'secret');
    assert.match(entry, /^fullykiosk:\$7\$101\$[A-Za-z0-9+/]{16}\$[A-Za-z0-9+/]{86}==$/);
  });

  test("the hash is reproducible from the entry's own salt/iterations (round-trip)", () => {
    // This is a self-consistency check, not independent proof the scheme
    // matches the real Mosquitto algorithm - that was verified manually
    // against a real mosquitto broker (see src/managedBroker.js file header).
    const entry = buildMosquittoPasswordEntry('fullykiosk', 'secret');
    const [, , iterations, salt, hash] = entry.split('$');
    const recomputed = crypto.pbkdf2Sync(
      'secret',
      Buffer.from(salt, 'base64'),
      Number(iterations),
      64,
      'sha512',
    );
    assert.equal(recomputed.toString('base64'), hash);
  });

  test('generates a different salt (and hash) on every call', () => {
    const a = buildMosquittoPasswordEntry('fullykiosk', 'secret');
    const b = buildMosquittoPasswordEntry('fullykiosk', 'secret');
    assert.notEqual(a, b);
  });
});

describe('buildMosquittoConfContent', () => {
  test('stays root (no privilege drop) and requires authentication', () => {
    const conf = buildMosquittoConfContent();
    assert.match(conf, /^user root$/m);
    assert.match(conf, /^allow_anonymous false$/m);
    assert.match(conf, /^password_file \/mosquitto\/config\/passwd$/m);
  });
});

describe('writeManagedBrokerConfig', () => {
  test('writes a world-readable mosquitto.conf and passwd file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullykiosk-managed-broker-'));
    try {
      writeManagedBrokerConfig('fullykiosk', 'secret', dir);

      const conf = fs.readFileSync(path.join(dir, 'mosquitto.conf'), 'utf8');
      assert.match(conf, /allow_anonymous false/);

      const passwd = fs.readFileSync(path.join(dir, 'passwd'), 'utf8').trim();
      assert.match(passwd, /^fullykiosk:\$7\$/);

      for (const file of ['mosquitto.conf', 'passwd']) {
        const mode = fs.statSync(path.join(dir, file)).mode & 0o777;
        assert.equal(mode, 0o644, `${file} should be world-readable (0o644)`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
