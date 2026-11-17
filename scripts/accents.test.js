'use strict';

// Press and hold: which accented forms a held letter offers, and in what
// order. The table runs on its own here; the strip itself is tested in
// scripts/accents.e2e.js.

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { describe, test } = require('node:test');

const app = require('./app-files').appSource();
const between = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));
const context = vm.createContext({});
vm.runInContext(between('const ACCENTS = {', 'let accentHeld = null;'), context);
vm.runInContext('this.api = { accentsFor, ACCENTS };', context);
const { accentsFor, ACCENTS } = context.api;

describe('the forms a held letter offers', () => {
  test('a letter with none offers none', () => {
    assert.deepEqual([...accentsFor('k', 'en-US')], []);
    assert.deepEqual([...accentsFor('7', 'en-US')], []);
  });

  test('English gets the table in its own order', () => {
    assert.equal(accentsFor('e', 'en-US').join(''), 'èéêëēėęě');
  });

  test("a language's own letters come first, so their numbers stay short", () => {
    assert.equal(accentsFor('e', 'fr').slice(0, 4).join(''), 'éèêë');
    assert.equal(accentsFor('a', 'ro').slice(0, 2).join(''), 'ăâ');
    assert.equal(accentsFor('s', 'ro')[0], 'ș');
    assert.equal(accentsFor('o', 'hu').slice(0, 3).join(''), 'óöő');
    assert.equal(accentsFor('a', 'pl')[0], 'ą');
    assert.equal(accentsFor('a', 'pt-BR')[0], 'ã');
  });

  test('a capital offers capitals, and none that is two letters or the same letter', () => {
    assert.equal(accentsFor('E', 'en-US').join(''), 'ÈÉÊËĒĖĘĚ');
    assert.ok(!accentsFor('S', 'de').includes('SS'), 'ß has no one-letter capital here');
    assert.ok(!accentsFor('I', 'tr').includes('I'), 'dotless ı is offered only small');
  });

  test('never more than nine, one for each number key', () => {
    for (const ch of Object.keys(ACCENTS)) {
      for (const lang of ['en-US', 'fr', 'pl', 'ro', 'hu', 'pt-BR', 'tr']) {
        const list = accentsFor(ch, lang);
        assert.ok(list.length <= 9, `${ch} in ${lang}: ${list.join('')}`);
        assert.equal(new Set(list).size, list.length, `${ch} in ${lang} repeats a form`);
        assert.equal(accentsFor(ch.toUpperCase(), lang).length <= 9, true);
      }
    }
  });

  test("every form is one character whose letter is the held one (or close to it: æ œ ø ł ß ı)", () => {
    for (const [ch, forms] of Object.entries(ACCENTS)) {
      for (const f of forms) {
        assert.equal([...f].length, 1, f);
        const base = f.normalize('NFD')[0];
        assert.ok(base === ch || 'æœøłßı'.includes(f), `${f} under ${ch}`);
      }
    }
  });
});
