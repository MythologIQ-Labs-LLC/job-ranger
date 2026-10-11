import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { IsolatedDriveAuthPopup } from '../src/pwa/drive/isolated-auth-popup.ts';

const SRC = readFileSync(new URL('../auth-helper/helper.mjs', import.meta.url), 'utf8');

test('offline full main/helper exchange uses distinct origins and never exposes token to UI', async () => {
  const appOrigin = 'http://localhost:4174', helperOrigin = 'http://localhost:4175';
  const widgets = Object.fromEntries(['status', 'load', 'authorize', 'cancel'].map(id =>
    ['#' + id, { disabled: id !== 'cancel', hidden: id === 'authorize', textContent: '',
      handlers: {}, addEventListener(n, f) { this.handlers[n] = f; }, click() { this.handlers.click?.(); } }]));
  const mainListeners = new Map(), helperListeners = new Map();
  const states = [], outgoing = [];
  let callbackConfig;
  const opener = {
    location: { origin: appOrigin },
    addEventListener(n, f) { mainListeners.set(n, f); },
    removeEventListener(n) { mainListeners.delete(n); },
    open() { return popup; },
    postMessage(data, targetOrigin) {
      assert.equal(targetOrigin, appOrigin);
      outgoing.push({ from: 'helper', data });
      // Structured cloning represents browser postMessage across realms.
      mainListeners.get('message')?.({ origin: helperOrigin, source: popup, data: structuredClone(data) });
    },
  };
  const popup = {
    closed: false, close() { this.closed = true; },
    postMessage(data, targetOrigin) {
      assert.equal(targetOrigin, helperOrigin);
      outgoing.push({ from: 'main', data });
      helperListeners.get('message')?.({ origin: appOrigin, source: opener, data });
    },
  };
  const helper = {
    opener,
    google: { accounts: { oauth2: { initTokenClient(options) {
      callbackConfig = options;
      return { requestAccessToken() {
        options.callback({
          access_token: 'FAKE_TWO_ORIGIN_TOKEN',
          scope: 'https://www.googleapis.com/auth/drive.file',
          expires_in: 3600,
        });
      } };
    } } } },
    addEventListener(n, f) { helperListeners.set(n, f); },
  };
  const callbacks = {};
  const context = createContext({
    window: helper, location: { origin: helperOrigin }, Date, URL,
    document: { querySelector(id) { return widgets[id]; }, createElement() { throw Error('Unexpected network'); } },
    setTimeout() { return 1; }, clearTimeout() {},
    setInterval(fn) { callbacks.ready = fn; return 2; }, clearInterval() {},
  });
  const module = new SourceTextModule(SRC, { context });
  const cfg = new SyntheticModule(['GOOGLE_WEB_CLIENT_ID', 'JOB_RANGER_APP_ORIGIN'], function() {
    this.setExport('GOOGLE_WEB_CLIENT_ID', '123-example.apps.googleusercontent.com');
    this.setExport('JOB_RANGER_APP_ORIGIN', appOrigin);
  }, { context });
  await module.link(() => cfg);
  const controller = new IsolatedDriveAuthPopup(helperOrigin, v => states.push(v), opener);
  controller.connectFromUserClick();
  await module.evaluate();
  assert.equal(outgoing[0].data.protocol, 'job-ranger:isolated-drive-auth-ready');
  assert.equal(outgoing[1].data.protocol, 'job-ranger:isolated-drive-auth-init');
  assert.equal(outgoing[2].data.protocol, 'job-ranger:isolated-drive-auth-initialized');
  assert.equal(widgets['#load'].disabled, false);
  widgets['#load'].click();
  assert.equal(callbackConfig.include_granted_scopes, false);
  widgets['#authorize'].click();
  assert.equal(controller.snapshot().phase, 'authorized_unverified');
  assert.equal(popup.closed, true);
  assert.equal(JSON.stringify(states).includes('FAKE_TWO_ORIGIN_TOKEN'), false);
  assert.equal(await controller.withTokenForUserAction(async token => token), 'FAKE_TWO_ORIGIN_TOKEN');
  controller.dispose();
  assert.equal(mainListeners.size, 0);
});
