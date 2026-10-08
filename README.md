# Local incident explorer

A complete local browser for 2,400 fictional support incidents, using Node.js 24 and its built-in HTTP server. No application dependencies or external services are used.

From the repository root, prepare the canonical dataset and pinned verification tooling:

```sh
npm run pretest
qualification-browser-smoke
```

Start the app:

```sh
npm run start
```

Open **http://127.0.0.1:3000**. Keep the terminal open; press **Ctrl+C** there to shut down the server. Optional `PORT=3001 npm run start` changes the port. The server binds only to `127.0.0.1`. The generated `.runtime/incidents.json` remains read-only to the app. `npm run seed` also creates the canonical data without installing tooling.

Verify from the repository root:

```sh
npm run pretest
qualification-browser-smoke
npm test
```

`npm test` preserves the baseline preparation hook and generic Node test discovery. The tests compare actual HTTP queries, details, summaries and parsed CSV with independent expectations from the full canonical dataset, then drive real sandbox-enabled Chromium through the interface. They suspend, stop and restart their owned server to exercise pending requests, genuine failures, selection changes and retry without replacing responses. They close the browser and every owned server in finally blocks. Evidence, downloaded CSV and desktop/narrow screenshots are under ignored `.runtime/`; these are runtime artifacts, not source deliverables.

Browser tooling uses pinned Playwright 1.64.0 and Chromium 156.0.8078.4. The qualification environment must expose `qualification-chromium` and `qualification-browser-smoke` on PATH. Tests locate the executable with `command -v qualification-chromium` and dynamically resolve `../browsers` and `../host-libs` from its alias directory. Before importing Playwright they set `PLAYWRIGHT_BROWSERS_PATH`, and launch with `{channel:'chromium', headless:true, chromiumSandbox:true}`. Chromium's explicit child environment supplies the resolved `LD_LIBRARY_PATH`, `ALSA_CONFIG_PATH`, and relative `.runtime/browser-tmp` as TMPDIR/TMP/TEMP. No sandbox relaxation is used.

Search is a case-insensitive literal match on ID, title or description. Multiple choices within a filter are OR; search, filter groups and inclusive UTC opened dates combine with AND. Counts and daily chart cover the complete matching set. Expand “Daily counts — text alternative” for readable counts. Query changes reset pagination; opening details and returning preserves the query, page, results and scroll position. Focus outlines and standard labeled controls support keyboard use. Named views are stored in this browser's localStorage and restore search, filters, dates, sorting and page size at page one.

The API is served from the same origin:

- `GET /api/incidents`: `q`, repeated `service`/`status`/`severity`, `from`/`to` (`YYYY-MM-DD` UTC), `sort=openedAt|severity`, `direction=asc|desc`, `page` (positive integer), `pageSize=25|50`. Defaults: no filters, newest first, page one, 25 rows. Response includes rows, normalized page/pageSize/pages, total, unresolved, highSeverity and daily `{date,count}` values. Invalid parameters return HTTP 400; oversized pages clamp to the last page, with empty results on page one.
- `GET /api/incidents/:id`: every incident field, or HTTP 404.
- `GET /api/export.csv`: the same matching and ordering parameters; exports all matching records regardless of pagination. Every field is included. Tags are a JSON array inside a CSV-escaped cell; null resolvedAt is an empty cell. CSV uses CRLF records, double-quoted fields and doubled embedded quotes, preserving punctuation and multiline descriptions.

Severity order from highest to lowest is critical, high, medium, low. Severity ties use openedAt descending; every sort finishes with ascending ID. All dataset strings are rendered as plain text. Query and detail revisions guard result, error and cleanup ownership; export has its own notification state and cannot replace a foreground retry target.

Keep `data/generate.mjs`, `data/FIELDS.md`, `scripts/prepare.mjs`, the lockfile, pinned dependencies and the baseline seed/pretest/test scripts unchanged. The data spans 90 UTC dates starting April 1, 2026. There are no editing, account or deployment features.
