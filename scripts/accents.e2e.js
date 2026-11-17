// End-to-end test for press and hold (ACCENTS in app/typing-rules.js), the
// strip NEO draws on Windows and Linux, on a throwaway
// library: a held letter opens the strip of its accented forms, a number,
// the arrows and Enter, or a click puts one in the letter's place, Esc keeps
// the letter, another key closes the strip and types, ⌘Z gives the plain
// letter back, a letter with no accents goes on repeating, and with the
// setting off holding a key is as it was. On a Mac the test plays Windows
// (accentStripHere), since a Mac uses its own picker. A held key is played as Chromium sees
// one: a keydown, then keydowns marked as repeats. Run with
// `npm run test:accents` (under xvfb-run without a display).

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-accents-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-accents-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night', spellLanguage: 'en-US',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

async function type(text) {
  for (const c of text) {
    const keyCode = c === ' ' ? 'Space' : c;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: c });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await tick(60);
  }
}
async function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await tick(80);
}
// a held letter: down (it types), then its repeats, then up
async function hold(c) {
  wc.sendInputEvent({ type: 'keyDown', keyCode: c });
  wc.sendInputEvent({ type: 'char', keyCode: c });
  await tick(60);
  for (let i = 0; i < 4; i++) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: c, modifiers: ['isAutoRepeat'] });
    wc.sendInputEvent({ type: 'char', keyCode: c, modifiers: ['isAutoRepeat'] });
    await tick(35);
  }
  wc.sendInputEvent({ type: 'keyUp', keyCode: c });
  await tick(120);
}
async function caretEnd(n) {
  await js(`(() => {
    const body = document.querySelector('.chapter-body');
    body.focus();
    const t = body.children[${n}].lastChild;
    getSelection().collapse(t, t.length);
  })()`);
  await tick(150);
}
const BASE = 'Rain fell on the harbor';
const typed = async (n) => (await js(`document.querySelector('.chapter-body').children[${n}].textContent`)).slice(BASE.length);
const strip = () => js(`(() => { const s = document.querySelector('.accent-strip'); return s ? s.textContent : null; })()`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a held letter opens its strip, and a number puts that form in its place', async () => {
  await caretEnd(0);
  await type(' caf');
  await hold('e');
  assert.equal(await strip(), 'è1é2ê3ë4ē5ė6ę7ě8');
  assert.equal(await typed(0), ' cafe', 'the repeats typed nothing');
  await key('2');
  assert.equal(await strip(), null);
  await type(' noir');
  assert.equal(await typed(0), ' café noir');
});

test('⌘Z gives the plain letter back', async () => {
  await caretEnd(1);
  await type(' ');
  await hold('e');
  await key('2');
  // what ⌘Z does (the Edit menu's Undo, which a sent key doesn't reach)
  await js(`document.execCommand('undo')`);
  await tick(100);
  assert.equal(await typed(1), ' e');
});

test('the arrows and Enter pick too', async () => {
  await caretEnd(2);
  await type(' ');
  await hold('a');
  await key('Right');
  await key('Right');
  await key('Right');
  await key('Enter');
  await type('n');
  assert.equal(await typed(2), ' ân');
});

test('a screen reader hears the forms, the arrows\' choice and the pick', async () => {
  await caretEnd(8);
  await type(' ');
  await hold('n');
  const said = () => js(`document.getElementById('accent-say').textContent`);
  const shape = await js(`(() => {
    const s = document.querySelector('.accent-strip');
    return {
      role: s.getAttribute('role'), label: s.getAttribute('aria-label'),
      options: [...s.children].map((b) => [b.getAttribute('role'), b.getAttribute('aria-label'), b.getAttribute('aria-keyshortcuts'), b.getAttribute('aria-selected')].join(' ')),
      numbersHidden: [...s.querySelectorAll('small')].every((n) => n.getAttribute('aria-hidden') === 'true')
    };
  })()`);
  assert.equal(shape.role, 'listbox');
  assert.equal(shape.label, 'Accents for n');
  assert.deepEqual(shape.options, ['option ñ 1 false', 'option ń 2 false', 'option ň 3 false']);
  assert.ok(shape.numbersHidden, 'the numbers are not read twice');
  await tick(80);
  assert.equal(await said(), 'Accents for n: ñ 1 ń 2 ň 3. A number picks one; Esc keeps the letter.');
  assert.equal(await js(`document.activeElement.classList.contains('chapter-body')`), true, 'the caret stays in the page');
  await key('Right');
  await key('Right');
  assert.equal(await js(`[...document.querySelectorAll('.accent-strip [aria-selected=true]')].map((b) => b.getAttribute('aria-label')).join()`), 'ń');
  await tick(80);
  assert.equal(await said(), 'ń 2');
  await key('Enter');
  await tick(80);
  assert.equal(await said(), 'ń');
  assert.equal(await typed(8), ' ń');
});

test('Esc keeps the letter; another key closes the strip and types', async () => {
  await caretEnd(3);
  await type(' ');
  await hold('e');
  await key('Escape');
  assert.equal(await strip(), null);
  await type('x');
  await hold('e');
  await type('x');
  assert.equal(await strip(), null);
  assert.equal(await typed(3), ' exex');
});

test('a click on a form picks it', async () => {
  await caretEnd(4);
  await type(' ');
  await hold('o');
  const at = await js(`(() => { const b = document.querySelector('.accent-strip').children[1].getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
  wc.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await tick(120);
  await type('k');
  assert.equal(await typed(4), ' ök');
});

test('a sentence that NEO capitalized offers capitals', async () => {
  await caretEnd(5);
  await type('. ');
  await hold('e');
  assert.equal(await strip(), 'È1É2Ê3Ë4Ē5Ė6Ę7Ě8');
  await key('2');
  assert.equal(await typed(5), '. É');
});

test('a letter with no accents goes on repeating', async () => {
  await caretEnd(6);
  await type(' ');
  await hold('k');
  assert.equal(await strip(), null);
  assert.match(await typed(6), /^ kk+$/);
});

test('with the setting off, holding a letter repeats it, as before', async () => {
  await js('pressHoldOn = false');
  try {
    await caretEnd(7);
    await type(' ');
    await hold('e');
    assert.equal(await strip(), null);
    assert.match(await typed(7), /^ ee+$/);
  } finally {
    await js('pressHoldOn = true');
  }
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    win.setBounds({ width: 1200, height: 800 });
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Accents', chapters: [
        { title: 'One', paras: Array.from({ length: 10 }, () => ({ text: ${JSON.stringify(BASE)} })) }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(300);
    // the setting on, and the strip as on Windows and Linux
    await js('pressHoldOn = true; accentStripHere = true');
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
