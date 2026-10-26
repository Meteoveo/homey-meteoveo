'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Athom certification (ADR-0829, amendment 2026-10-26): the full Web API
// permission is only for apps whose core function needs it.
test('the app does not ask for full access to Homey', () => {
  for (const file of ['app.json', '.homeycompose/app.json']) {
    assert.equal((JSON.parse(read(file)).permissions || []).includes('homey:manager:api'), false, file);
  }
  assert.equal('homey-api' in (JSON.parse(read('package.json')).dependencies || {}), false);
});

// App Store guideline 1.3: one or two plain-text paragraphs, no URLs; the
// reviewer also asked what MeteoVeo Plus is, what it costs and where to get it.
test('the readme is short, plain text and explains MeteoVeo Plus', () => {
  const prices = { 'README.txt': ['€1.99', '€14.99'], 'README.es.txt': ['1,99 €', '14,99 €'] };
  for (const [file, [month, year]] of Object.entries(prices)) {
    const text = read(file).trim();
    const paragraphs = text.split(/\n\s*\n/);
    assert.ok(paragraphs.length <= 2, `${file}: ${paragraphs.length} paragraphs`);
    assert.doesNotMatch(text, /https?:|www\./, file);
    assert.doesNotMatch(text, /^\s*[-*#]/m, file);
    assert.match(text, /MeteoVeo Plus/, file);
    assert.ok(text.includes(month) && text.includes(year), `${file}: price`);
    assert.match(text, /Android/, file);
    assert.match(text, /iPhone/, file);
  }
});
