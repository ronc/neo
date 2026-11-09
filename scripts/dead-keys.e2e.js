// End-to-end test for typing through the system's composer: a dead key
// (U.S. International's ' and ", the Mac's ⌥E) hands the page its text as a
// composition, with keyCode 229, so smartKeys never saw it and quotes stayed
// straight, and an accented letter starting a sentence stayed small. The
// composition is played here through Chromium's own input method calls
// (Input.imeSetComposition, then Input.insertText to commit it), on a
// throwaway library. Run with `npm run test:dead-keys` (under xvfb-run
// without a display).

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-dead-keys-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-dead-keys-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night', spellLanguage: 'en-US',
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
const MOD = process.platform === 'darwin' ? 'meta' : 'control';

async function type(text) {
  for (const c of text) {
    const keyCode = c === ' ' ? 'Space' : c;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: c });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await tick(60);
  }
}
// what a dead key does: the mark is shown while composing, then the
// composer commits what it made of it and the next key
async function deadKey(mark, committed) {
  await wc.debugger.sendCommand('Input.imeSetComposition', { text: mark, selectionStart: 1, selectionEnd: 1 });
  await tick(30);
  await wc.debugger.sendCommand('Input.insertText', { text: committed });
  await tick(120);
}
// the caret at the end of paragraph n's text (inside its text node, as
// after typing)
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

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("' after a space opens a quotation, after a word it is an apostrophe", async () => {
  await caretEnd(0);
  await type(' ');
  await deadKey("'", "'");
  await type('Tis');
  await deadKey("'", "'");
  assert.equal(await typed(0), ' ‘Tis’');
});

test('" opens and closes', async () => {
  await caretEnd(1);
  await type(' ');
  await deadKey('"', '"');
  await type('hi');
  await deadKey('"', '"');
  await type(' she');
  assert.equal(await typed(1), ' “hi” she');
});

test("' with the letter after it (don't) keeps the letter", async () => {
  await caretEnd(2);
  await type(' don');
  await deadKey("'", "'t");
  await type(' go');
  assert.equal(await typed(2), ' don’t go');
});

test('an accented letter starting a sentence is a capital, and ⌘Z gives it back small', async () => {
  await caretEnd(3);
  await type('. ');
  await deadKey('´', 'é');
  assert.equal(await typed(3), '. É');
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'z', modifiers: [MOD] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'z', modifiers: [MOD] });
  await tick(150);
  assert.equal(await typed(3), '. é');
});

test('an accented letter inside a sentence is left alone', async () => {
  await caretEnd(4);
  await type(' caf');
  await deadKey('´', 'é');
  await type(' noir');
  assert.equal(await typed(4), ' café noir');
});

test("an input method's longer text is left as it came", async () => {
  await caretEnd(5);
  await type(' ');
  await deadKey('ab', "ab'c");
  await type('. ');
  await deadKey('k', '日本');
  assert.equal(await typed(5), " ab'c. 日本");
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
    wc.debugger.attach('1.3');
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Dead keys', chapters: [
        { title: 'One', paras: Array.from({ length: 8 }, () => ({ text: ${JSON.stringify(BASE)} })) }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(300);
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
