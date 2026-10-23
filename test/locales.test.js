'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ICON_KEYS, WARNING_LEVELS } = require('../lib/convert');

const read = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', `${lang}.json`), 'utf8'));
const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (
  v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));

const en = Object.fromEntries(flatten(read('en')));
const es = Object.fromEntries(flatten(read('es')));

test('English and Spanish have exactly the same keys, none empty', () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const [key, value] of Object.entries({ ...en, ...es })) assert.ok(String(value).trim(), key);
});

test('every error code the app or the contract can produce is translated', () => {
  const source = ['lib/pairing.js', 'drivers/meteoveo/driver.js', 'drivers/meteoveo/device.js']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  const thrown = [...source.matchAll(/PairingError\('([a-z_]+)'\)/g)].map((m) => m[1]);
  const used = [...source.matchAll(/__\(['`]errors\.([a-z_]+)['`]\)/g)].map((m) => m[1]);
  // Codes from docs/integracio-szerzodes-v1.md (account and key endpoints).
  const contract = ['weak_password', 'registration_closed', 'invalid_code', 'invalid_credentials', 'confirm_mismatch',
    'password_required', 'invalid_password', 'invalid_location', 'unknown_station', 'too_many_keys'];
  for (const code of new Set([...thrown, ...used, ...contract, 'unavailable', 'unknown'])) {
    assert.ok(en[`errors.${code}`], `errors.${code}`);
  }
});

test('every condition key and warning level has a name', () => {
  for (const key of ICON_KEYS) assert.ok(en[`conditions.${key}`], key);
  for (const level of WARNING_LEVELS) assert.ok(en[`levels.${level}`], level);
});
