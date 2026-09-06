import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  generateManagedBrokerCredentials,
  ensureManagedBrokerCredentials,
  findManagedBrokerHostPort,
  buildCredentialsMessage,
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
  test('includes the username, password and host port when available', () => {
    const message = buildCredentialsMessage({
      username: 'fullykiosk',
      password: 'secret123',
      hostPort: 41883,
    });
    assert.match(message.en, /fullykiosk/);
    assert.match(message.en, /secret123/);
    assert.match(message.en, /41883/);
    assert.match(message.fr, /fullykiosk/);
  });

  test('explains the broker is not started yet when no host port is known', () => {
    const message = buildCredentialsMessage({ username: 'x', password: 'y', hostPort: null });
    assert.match(message.en, /not started yet/);
    assert.match(message.fr, /pas encore démarré/);
  });
});
