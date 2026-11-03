# Third-Party Notices

## career-ops lineage

Sojourner is an independent project. Some career-search workflow concepts in Sojourner's career intelligence work were informed by the open-source **career-ops** project by Santiago Fernández de Valderrama.

- Upstream project: `career-ops-hq/career-ops`
- License: MIT
- Relationship: independent project; no endorsement, sponsorship, certification, or official affiliation is implied.
- Branding: Sojourner does not use the career-ops name as a product name, logo, or "powered by" claim.

Where Sojourner incorporates or adapts code from career-ops, the following MIT notice applies to those portions:

```text
MIT License

Copyright (c) 2026 Santiago Fernández de Valderrama

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Career-ops also publishes a separate trademark policy covering its project name and brand. Sojourner's attribution above is descriptive lineage only and is intentionally written to avoid implying an official relationship.

## Anydoc

Sojourner uses **Anydoc** for local extraction of text-bearing DOCX and PDF resume documents. Sojourner invokes the packaged parser directly and keeps hosted OCR disabled by default; imported content is preserved and proposed as reviewable career evidence rather than automatically becoming user-confirmed fact.

- Project: `firecrawl/anydoc`
- Version adopted: `0.2.4`
- License: MIT
- Copyright: Copyright (c) 2026 Sideguide Technologies Inc.
- Relationship: third-party runtime dependency; no endorsement, sponsorship, or official affiliation is implied.

The following MIT notice applies to Anydoc and its packaged platform-native components:

```text
MIT License

Copyright (c) 2026 Sideguide Technologies Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## SQLite

Sojourner's packaged Windows release includes the official SQLite command-line shell so normal users do not need to install a separate SQLite executable.

- Project: SQLite
- Distribution source: `sqlite.org`
- Bundled Windows release line: SQLite 3.53.4 x64 command-line shell
- Status: SQLite's authors dedicate the SQLite deliverable code to the public domain; no SQLite license is required for redistribution of the bundled executable.
- Release integrity: the Windows release workflow downloads the pinned official tools archive and verifies its published SHA3-256 digest before extracting `sqlite3.exe`.

SQLite is a separate project. Its inclusion does not imply endorsement of Sojourner by the SQLite authors or Hwaci.

## Web/PWA runtime components

The web/PWA build (`dist-pwa/`) bundles the following third-party components. They are not part of the Electron desktop package, which continues to use the bundled SQLite CLI and Anydoc. Each is used unmodified, as distributed on npm, and runs locally in the user's browser. No component sends data to a hosted service.

| Component | Version | License | Use |
| --- | --- | --- | --- |
| `@sqlite.org/sqlite-wasm` (SQLite compiled to WebAssembly with the SQLite project's JavaScript API) | 3.53.4-build2 | SQLite: public domain ("May you do good and not evil" blessing). npm wrapper: Apache-2.0 | Local database engine (origin-private file system) |
| `pdfjs-dist` (Mozilla PDF.js) | 6.4.299 | Apache-2.0 | Local text extraction from user-selected PDFs and from generated resume PDFs (Parseability Gate) |
| `pdf-lib` | 1.17.1 | MIT. Includes `@pdf-lib/standard-fonts` (MIT; standard-14 font metrics), `@pdf-lib/upng` (MIT), `pako` (MIT AND Zlib), `tslib` (0BSD) | Deterministic ATS resume PDF writing |
| `fflate` | 0.8.3 | MIT | Bounded local unzip of DOCX documents; deterministic web release archive packaging (build time) |
| `@pdf-lib/fontkit` | 1.1.1 | MIT. Its distributed bundle inlines `restructure`, `unicode-trie`, `unicode-properties`, `dfa`, `clone`, `base64-arraybuffer`, a Brotli decoder (Google), and Node.js `util` code, all MIT. Depends on `pako` (MIT AND Zlib) | Font parsing and subsetting for resume PDFs with text outside Windows-1252 (loaded only when needed) |
| Noto Sans, Noto Sans Thai, Noto Sans SC / TC / JP / KR (via `@fontsource/noto-sans*` 5.3.0) | 5.3.0 | SIL Open Font License 1.1 | Embedded, subset fonts in web-generated resume PDFs. License texts ship with the fonts as `fonts/LICENSE-<family>.txt` |
| `wawoff2` (build time only, not shipped) | 2.0.1 | MIT | Converts the WOFF2 font slices to TrueType during the web build |

License texts ship in `node_modules/<package>/LICENSE*` where the package provides them. The SIL OFL 1.1 permits embedding and redistributing the Noto fonts in documents and with software; the fonts are not sold on their own and keep their reserved names. `@sqlite.org/sqlite-wasm` declares Apache-2.0 in its `package.json`, and the SQLite core it embeds is public domain. The Apache-2.0 components adopted here include no `NOTICE` files that need reproducing. Re-check both when upgrading.

Relationship: third-party dependencies only; no endorsement, sponsorship, or affiliation is implied.
