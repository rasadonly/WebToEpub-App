import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryMatchScore, matchesLibrarySearch } from './librarySearch.ts';

const unrelated = ['武圣从叠被动开始 C', '科举 第一女首辅 C', '暗杀夫妻 首辅夫君太难杀 C'];
test('Chinese titles with a C suffix do not match unrelated English queries', () => {
  for (const title of unrelated) {
    assert.equal(libraryMatchScore(title, 'Shadow Slave'), 0);
    assert.equal(libraryMatchScore(title, 'Surviving The Game As A Barbarian'), 0);
  }
  assert.equal(libraryMatchScore('C', 'crime solving chat group'), 0);
});
test('Chinese queries match only the relevant Chinese titles', () => {
  assert.equal(matchesLibrarySearch(unrelated[0], '', '科举'), false);
  assert.equal(matchesLibrarySearch(unrelated[1], '', '科举'), true);
  assert.equal(libraryMatchScore(unrelated[0], '武圣从叠被动开始'), 0.85);
});
test('empty submitted search restores all books but punctuation does not', () => {
  assert.equal(matchesLibrarySearch('Shadow Slave', '', ''), true);
  assert.equal(matchesLibrarySearch('Shadow Slave', '', '!!!'), false);
});
test('spacing, punctuation, and multilingual titles remain searchable', () => {
  assert.equal(matchesLibrarySearch('Shadow Slave', '', 'ShadowSlave'), true);
  assert.equal(libraryMatchScore('Lord of Mysteries.epub', 'Lord of Mysteries'), 1);
  assert.equal(matchesLibrarySearch('進撃の巨人', '', '進撃'), true);
  assert.equal(matchesLibrarySearch('Other Book', 'Émile Zola', 'Émile'), true);
});