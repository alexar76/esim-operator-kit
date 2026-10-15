import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

function theme({ saved = null, dark = false, storageBlocked = false } = {}) {
  const handlers = {}, attrs = {}, root = { dataset: {}, lang: 'ru' }, meta = {};
  const button = { setAttribute: (k, v) => { attrs[k] = v; }, addEventListener: (k, fn) => { handlers[k] = fn; } };
  const system = { matches: dark, addEventListener: (_, fn) => { handlers.system = fn; } };
  const storage = new Map(saved ? [['esim-theme', saved]] : []);
  const document = {
    documentElement: root, querySelector: () => meta, querySelectorAll: () => [button],
    addEventListener: (_, fn) => { handlers.ready = fn; }
  };
  runInNewContext(source('theme.js'), {
    document, Event, MutationObserver: class { constructor(fn) { handlers.language = fn; } observe() {} },
    window: { matchMedia: () => system, dispatchEvent() {}, addEventListener: (k, fn) => { handlers[k] = fn; } },
    localStorage: {
      getItem: (key) => { if (storageBlocked) throw Error('disabled'); return storage.get(key); },
      setItem: (key, value) => { if (storageBlocked) throw Error('disabled'); storage.set(key, value); }
    }
  });
  return { root, meta, attrs, handlers, storage, system };
}

test('theme applies before DOM ready; explicit light overrides a dark system and survives reload', () => {
  const t = theme({ saved: 'light', dark: true });
  assert.equal(t.root.dataset.theme, 'light');
  t.handlers.ready();
  assert.equal(t.attrs['aria-label'], 'Включить тёмную тему');
  t.handlers.click();
  assert.equal(t.root.dataset.theme, 'dark');
  assert.equal(t.attrs['aria-pressed'], 'true');
  assert.equal(theme({ saved: t.storage.get('esim-theme') }).root.dataset.theme, 'dark');
});

test('theme follows the system until chosen, syncs tabs, and localizes after changing language', () => {
  const t = theme();
  t.handlers.ready();
  t.system.matches = true; t.handlers.system();
  assert.equal(t.root.dataset.theme, 'dark');
  t.handlers.click(); t.handlers.system();
  assert.equal(t.root.dataset.theme, 'light');
  t.handlers.storage({ key: 'esim-theme', newValue: 'dark' });
  assert.equal(t.root.dataset.theme, 'dark');
  t.root.lang = 'fr'; t.handlers.language();
  assert.equal(t.attrs['aria-label'], 'Activer le thème clair');
});

test('theme still toggles with blocked storage and ignores invalid saved values', () => {
  const t = theme({ storageBlocked: true }); t.handlers.ready(); t.handlers.click();
  assert.equal(t.root.dataset.theme, 'dark');
  assert.equal(theme({ saved: 'invalid', dark: true }).root.dataset.theme, 'dark');
});

test('the static landing ships the same theme behavior as the storefront', () => {
  assert.equal(source('theme.js'), readFileSync(new URL('../../docs/landing/theme.js', import.meta.url), 'utf8'));
});

test('search submits once to the country, supports codes and English names, and explains unknown destinations', () => {
  const handlers = {}, location = { href: 'https://shop.example/ru/' }, status = { hidden: true };
  const input = { value: '', addEventListener: (k, fn) => { handlers[k] = fn; }, form: { addEventListener: (k, fn) => { handlers[k] = fn; } } };
  runInNewContext(source('store.js'), { location, document: {
    getElementById: (id) => id === 'page-data' ? { textContent: JSON.stringify({ page: 'home', lang: 'ru', countries: [['JP', 'Япония', 'Japan']] }) } : input,
    querySelector: () => status
  } });
  for (const value of [' JP ', 'Япония', 'Japan']) {
    input.value = value; let prevented = false;
    handlers.submit({ preventDefault() { prevented = true; } });
    assert.ok(prevented); assert.equal(location.href, '/ru/c/jp'); assert.equal(status.hidden, true);
  }
  input.value = 'Atlantis'; location.href = '/ru/'; handlers.submit({ preventDefault() {} });
  assert.equal(location.href, '/ru/'); assert.equal(status.hidden, false);
});
