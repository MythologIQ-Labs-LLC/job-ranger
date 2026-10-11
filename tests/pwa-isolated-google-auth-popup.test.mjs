import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IsolatedDriveAuthPopup, ISOLATED_DRIVE_AUTH_INIT } from '../src/pwa/drive/isolated-auth-popup.ts';
import { ISOLATED_DRIVE_AUTH_PROTOCOL, ISOLATED_DRIVE_SCOPE, ISOLATED_DRIVE_AUTH_VERSION } from '../src/pwa/drive/isolated-auth-channel.ts';

function harness({ blocked = false } = {}) {
  const listeners = new Map(); const events = []; const sent = [];
  const popup = {
    closed: false,
    close() { this.closed = true; },
    postMessage(message, targetOrigin) { sent.push({ message, targetOrigin }); },
  };
  const host = {
    location: { origin: 'http://localhost:4174' },
    addEventListener(kind, fn) { listeners.set(kind, fn); },
    removeEventListener(kind) { listeners.delete(kind); },
    open(url, name, features) {
      events.push({ url, name, features });
      return blocked ? null : popup;
    },
  };
  const controller = new IsolatedDriveAuthPopup('http://localhost:4175', (v) => events.push(v), host);
  function message(data, { origin = 'http://localhost:4175', source = popup } = {}) {
    listeners.get('message')?.({ origin, source, data });
  }
  function init() {
    controller.connectFromUserClick();
    message({ protocol: 'job-ranger:isolated-drive-auth-ready', version: ISOLATED_DRIVE_AUTH_VERSION });
    const handoff = sent.at(-1);
    assert.equal(handoff.targetOrigin, 'http://localhost:4175');
    assert.equal(handoff.message.protocol, ISOLATED_DRIVE_AUTH_INIT);
    assert.match(handoff.message.nonce, /^[0-9a-f]{48}$/);
    message({ protocol: 'job-ranger:isolated-drive-auth-initialized', version: ISOLATED_DRIVE_AUTH_VERSION, nonce: handoff.message.nonce });
    return handoff.message.nonce;
  }
  const success = (nonce) => ({
    protocol: ISOLATED_DRIVE_AUTH_PROTOCOL, version: ISOLATED_DRIVE_AUTH_VERSION,
    nonce, requestingOrigin: host.location.origin, kind: 'authorized',
    scope: ISOLATED_DRIVE_SCOPE, token: 'SENSITIVE_FAKE_TOKEN', expiresInSeconds: 3600,
  });
  return { host, popup, sent, events, controller, message, init, success, listeners };
}

test('popup opens synchronously to exact helper origin, with no token or nonce in URL', () => {
  const x = harness(); x.init();
  assert.equal(x.events[0].url, 'http://localhost:4175/');
  assert.equal(x.controller.snapshot().phase, 'authorizing');
  x.controller.dispose();
});

test('one signed message handoff yields unverified session without leaking token in view', async () => {
  const x = harness(); const nonce = x.init();
  x.message(x.success(nonce));
  assert.equal(x.controller.snapshot().phase, 'authorized_unverified');
  assert.equal(JSON.stringify(x.events).includes('SENSITIVE_FAKE_TOKEN'), false);
  assert.equal(await x.controller.withTokenForUserAction(async token => token), 'SENSITIVE_FAKE_TOKEN');
  assert.equal(x.popup.closed, true);
  x.controller.dispose();
});

test('forged origin/source and nonce cannot authorize; nonce mismatch aborts', async () => {
  const x = harness(); const nonce = x.init();
  x.message(x.success(nonce), { origin: 'http://localhost:4176' });
  x.message(x.success(nonce), { source: {} });
  assert.equal(x.controller.snapshot().phase, 'authorizing');
  x.message(x.success('00'.repeat(24)));
  assert.equal(x.controller.snapshot().phase, 'action_needed');
  await assert.rejects(x.controller.withTokenForUserAction(async token => token));
  x.controller.dispose();
});

test('blocked popup has actionable error, no token, listener cleanup', () => {
  const x = harness({ blocked: true });
  x.controller.connectFromUserClick();
  assert.match(x.controller.snapshot().message, /blocked/);
  assert.equal(x.listeners.size, 0);
  x.controller.dispose();
});

test('manual cancellation blocks stale popup responses', async () => {
  const x = harness(); const nonce = x.init();
  x.controller.forgetSession();
  x.message(x.success(nonce));
  assert.equal(x.controller.snapshot().phase, 'action_needed');
  await assert.rejects(x.controller.withTokenForUserAction(async token => token));
  x.controller.dispose();
});

test('unconfigured same-origin helper is never allowed', () => {
  assert.throws(() => new IsolatedDriveAuthPopup('http://localhost:4174', () => {}, { location: { origin: 'http://localhost:4174' } }), /separate origin/);
});

test('throwing window.open clears the listener and reports a retryable failure', async () => {
  const x = harness();
  x.host.open = () => { throw new Error('SecurityError: popup denied'); };
  assert.doesNotThrow(() => x.controller.connectFromUserClick());
  assert.equal(x.controller.snapshot().phase, 'action_needed');
  assert.match(x.controller.snapshot().message, /could not open/i);
  assert.equal(x.listeners.size, 0, 'failed opener must never retain a message handler');
  await assert.rejects(x.controller.withTokenForUserAction(async token => token));
  x.controller.dispose();
});

test('throwing child postMessage fails immediately rather than leaving authorizing spinner', async () => {
  const x = harness();
  x.popup.postMessage = () => { throw new Error('SecurityError: WindowProxy severed'); };
  x.controller.connectFromUserClick();
  x.message({ protocol: 'job-ranger:isolated-drive-auth-ready', version: ISOLATED_DRIVE_AUTH_VERSION });
  assert.equal(x.controller.snapshot().phase, 'action_needed');
  assert.match(x.controller.snapshot().message, /lost its secure connection/i);
  assert.equal(x.popup.closed, true);
  assert.equal(x.listeners.size, 0);
  await assert.rejects(x.controller.withTokenForUserAction(async token => token));
  x.controller.dispose();
});
