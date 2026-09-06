import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseTablets, sendCommand } from '../src/FullyKioskClient.js';

describe('parseTablets', () => {
  test('parses "ip:password" lines', () => {
    const tablets = parseTablets('192.168.1.50:secret1\n192.168.1.51:secret2');
    assert.deepEqual(tablets.get('192.168.1.50'), { port: 2323, password: 'secret1' });
    assert.deepEqual(tablets.get('192.168.1.51'), { port: 2323, password: 'secret2' });
  });

  test('parses "ip:port:password" lines with a custom port', () => {
    const tablets = parseTablets('192.168.1.50:8080:secret1');
    assert.deepEqual(tablets.get('192.168.1.50'), { port: 8080, password: 'secret1' });
  });

  test('accepts comma-separated entries and ignores blank lines', () => {
    const tablets = parseTablets('192.168.1.50:secret1, 192.168.1.51:secret2\n\n');
    assert.equal(tablets.size, 2);
  });

  test('ignores malformed lines', () => {
    const tablets = parseTablets('not-a-valid-line\n192.168.1.50:secret1');
    assert.equal(tablets.size, 1);
    assert.ok(tablets.has('192.168.1.50'));
  });

  test('returns an empty map for empty input', () => {
    assert.equal(parseTablets('').size, 0);
    assert.equal(parseTablets(undefined).size, 0);
  });
});

describe('sendCommand', () => {
  test('builds the expected REST URL and parses a JSON response', async (t) => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      calls.push(url.toString());
      return {
        ok: true,
        text: async () => JSON.stringify({ status: 'OK' }),
      };
    });

    const target = { ip: '192.168.1.50', port: 2323, password: 'secret', useHttps: false };
    const result = await sendCommand(target, 'screenOn', { extra: 'value' });

    assert.equal(calls.length, 1);
    const url = new URL(calls[0]);
    assert.equal(url.origin, 'http://192.168.1.50:2323');
    assert.equal(url.searchParams.get('cmd'), 'screenOn');
    assert.equal(url.searchParams.get('password'), 'secret');
    assert.equal(url.searchParams.get('type'), 'json');
    assert.equal(url.searchParams.get('extra'), 'value');
    assert.deepEqual(result, { status: 'OK' });
  });

  test('uses https when requested', async (t) => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      calls.push(url.toString());
      return { ok: true, text: async () => 'ok' };
    });

    await sendCommand(
      { ip: '192.168.1.50', port: 2323, password: 'secret', useHttps: true },
      'deviceInfo',
    );

    assert.ok(calls[0].startsWith('https://'));
  });

  test('throws on a non-2xx response', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 401,
      text: async () => 'wrong password',
    }));

    await assert.rejects(
      sendCommand(
        { ip: '192.168.1.50', port: 2323, password: 'wrong', useHttps: false },
        'screenOn',
      ),
      /HTTP 401/,
    );
  });
});
