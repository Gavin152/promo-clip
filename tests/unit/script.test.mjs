import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScript, stripTags, words } from '../../engine/tools/lib/script.mjs';
import { parseArgs } from '../../engine/tools/lib/args.mjs';

const MD = `# Script: Test clip

## 01-hook
> [excited] Charter week!
> Seven days, gone.
Picture: calendar pages fly away.

## 02-reveal
> [upbeat] Good news.

Picture: stamp.
`;

test('scenes, spoken text without tags, TTS text with tags', () => {
  const s = parseScript(MD);
  assert.equal(s.title, 'Test clip');
  assert.deepEqual(s.scenes.map((x) => x.id), ['01-hook', '02-reveal']);
  assert.equal(s.scenes[0].n, 1);
  assert.equal(s.scenes[0].name, 'hook');
  assert.equal(s.scenes[0].spoken, 'Charter week! Seven days, gone.');
  assert.equal(s.scenes[0].picture, 'Picture: calendar pages fly away.');
  assert.equal(s.ttsText, '[excited] Charter week! Seven days, gone.\n\n[upbeat] Good news.');
  assert.deepEqual(s.words, ['Charter', 'week!', 'Seven', 'days,', 'gone.', 'Good', 'news.']);
});

test('scene boundaries point at the pause between scenes', () => {
  assert.deepEqual(parseScript(MD).boundaries, [{ scene: '02-reveal', after: 'gone.', before: 'Good', afterIndex: 4 }]);
});

test('the fixture script parses into 3 scenes and 21 words', () => {
  const s = parseScript(readFileSync(new URL('../../fixtures/sample-15s/script.md', import.meta.url), 'utf8'));
  assert.equal(s.scenes.length, 3);
  assert.equal(s.words.length, 21);
  assert.equal(s.boundaries.length, 2);
});

test('tag helpers', () => {
  assert.equal(stripTags('[a, b] Hi [c] there'), 'Hi there');
  assert.deepEqual(words(' [x] a  b '), ['a', 'b']);
});

test('args: positionals, valued flags, booleans, --k=v', () => {
  const { pos, flags } = parseArgs(['stills', 'out', '2', '--format', 'vertical', '--scenes', '8', '--size=4K', '--json']);
  assert.deepEqual(pos, ['stills', 'out', '2', '8']);
  assert.deepEqual(flags, { format: 'vertical', scenes: true, size: '4K', json: true });
});
