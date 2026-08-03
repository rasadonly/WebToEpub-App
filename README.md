# LinkToEpub

Convert web novels into clean, device-ready EPUB files — straight from a link.

Paste a table-of-contents or chapter URL, or search a novel by name, and LinkToEpub
fetches the chapters, cleans the HTML and packs a properly formatted EPUB you can read
anywhere (Kindle, Kobo, Apple Books, Moon+ Reader, and the built-in reader).

**Live app:** https://epub-novel-forge.lovable.app

## Features

- **Link or search** — paste a TOC/chapter URL, or type a novel name to search supported sites.
- **380+ site parsers** — Novelfull, NovelBin, NovelFire, WTR-LAB, Royal Road, Scribble Hub,
  FreeWebNovel and many more, with an AI fallback parser for unknown sites.
- **Chapter manager** — select a range, remove chapters, reorder or reverse the list.
- **Metadata** — auto-detected title, author, language and cover, all editable before export.
- **Live reader** — read a novel in-app with themes, font controls, auto-scroll and text-to-speech.
- **EPUB reader** — open any generated or local EPUB in the built-in reader.
- **Community library** — finished books can be saved to a shared library.
- **Forum** — Reddit-style threads for requests, site reports and discussion.
- **Supported sites page** — live up/down health status, sorted by availability.
- **Server mode (optional)** — offload long conversions to a backend so they keep running
  after you close the tab; can be disabled to run fully in the browser.

## How to use

1. **Paste or search** — drop a table-of-contents or chapter link, or type a novel name.
2. **Pick chapters** — check the detected title/author, then choose a range, reorder or remove chapters.
3. **Get your EPUB** — convert and download, or open the book in the built-in reader.

## Tech stack

- React 18 + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- JSZip / FileSaver for EPUB packaging, epub.js for reading
- Vendored WebToEpub parser engine (`public/webtoepub`)
- Lovable Cloud (Postgres + edge functions) for forum, admin and site health
- Optional Node/Express backend (`/server`) deployed to Heroku and a Hugging Face Space

## Local development

Requires Node.js and npm ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
npm i
npm run dev
```

Build for production:

```sh
npm run build
npm run preview
```

## Project structure

```text
src/
  components/      UI: conversion form, chapter manager, readers, library, forum, admin
  hooks/           useEpubConverter — conversion orchestration
  utils/           epub generation, worker/proxy fetching, backend + site configs
public/webtoepub/  vendored parser engine and site parsers
server/            optional Express backend (jobs, fetching, library uploads)
supabase/          database migrations and edge functions
```

## Contributing

Site parsers live in `public/webtoepub/plugin/js/parsers/`, and server-side selectors in
`server/src/siteConfigs.json`. Adding support for a new site usually means adding a parser
there plus an entry in the site config table. Broken sites can also be reported in the
in-app forum.

## Editing this project

This app is built with [Lovable](https://lovable.dev/projects/90188eb1-eb07-47f6-92bb-828b64c28c78).
Prompt changes in Lovable, or clone the repo and push — changes sync both ways. You can also
edit files directly on GitHub or in a GitHub Codespace.

To publish, open the project in Lovable and click **Share → Publish**. Custom domains can be
connected under **Project → Settings → Domains**.
