import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sendEpub } from "./src/download.js";
import { buildEpub } from "./src/epub.js";

async function downloadFixture(t, filename, missing = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epub-download-test-"));
  const file = path.join(dir, "sample.epub");
  const bytes = await buildEpub([{ title: "Chapter 1", content: "<p>Sample chapter content.</p>" }], { title: filename });
  if (!missing) await fs.writeFile(file, bytes);
  const app = express();
  app.get("/download", (_req, res) => sendEpub(res, file, filename));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { response: await fetch(`http://127.0.0.1:${address.port}/download`), bytes };
}

test("Chinese book title downloads with encoded filename and intact EPUB bytes", async t => {
  const filename = "被瘋批哄騙的陰鬱男高.epub";
  const { response, bytes } = await downloadFixture(t, filename);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/epub+zip");
  assert.ok(response.headers.get("content-disposition").includes(`filename*=UTF-8''${encodeURIComponent(filename)}`));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test("ASCII title retains the epub filename", async t => {
  const { response } = await downloadFixture(t, "sample_book.epub");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="sample_book.epub"');
  await response.arrayBuffer();
});

test("control characters cannot break the response and extension is epub", async t => {
  const { response } = await downloadFixture(t, "book\r\nname");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="book__name.epub"');
  await response.arrayBuffer();
});

test("missing completed file returns a useful 404 instead of an unhandled stream error", async t => {
  const { response } = await downloadFixture(t, "book.epub", true);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /convert the book again/);
});