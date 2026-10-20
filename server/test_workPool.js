import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createWorkPool, DEFAULT_MAX_ACTIVE_JOBS } from "./src/workPool.js";
import { buildEpub, writeChapterFile } from "./src/epub.js";

test("40 jobs start together and job 41 starts when a slot opens", async () => {
  assert.equal(DEFAULT_MAX_ACTIVE_JOBS, 40);
  const pool = createWorkPool(DEFAULT_MAX_ACTIVE_JOBS);
  const release = [];
  let started = 0;
  const work = Array.from({ length: 41 }, () => pool.run(() => {
    started++;
    return new Promise(resolve => release.push(resolve));
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 40);
  assert.equal(pool.waiting, 1);
  release[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 41);
  release.forEach(resolve => resolve());
  await Promise.all(work);
});

test("failed work frees its slot", async () => {
  const pool = createWorkPool(1);
  const failed = pool.run(() => { throw new Error("failed"); });
  const next = pool.run(() => 42);
  await assert.rejects(failed, /failed/);
  assert.equal(await next, 42);
});

test("disk-backed EPUB preserves chapter order, metadata and content", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epub-stream-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const chapters = [];
  for (let i = 0; i < 3; i++) {
    const file = path.join(dir, `${i}.xhtml`);
    await writeChapterFile(file, { title: `Chapter ${i + 1}`, content: `<p>Unique content ${i}</p>` });
    chapters.push({ title: `Chapter ${i + 1}`, file });
  }
  const output = path.join(dir, "book.epub");
  await buildEpub(chapters, { title: "測試 Book", author: "Test Author" }, {}, output);
  const zip = await JSZip.loadAsync(await fs.readFile(output));
  assert.equal(await zip.file("mimetype").async("string"), "application/epub+zip");
  assert.match(await zip.file("OEBPS/content.opf").async("string"), /測試 Book/);
  for (let i = 0; i < 3; i++) {
    assert.match(await zip.file(`OEBPS/chapter_00${i + 1}.xhtml`).async("string"), new RegExp(`Unique content ${i}`));
  }
});