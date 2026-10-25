# Jobicy → Airtable

Synchronize remote jobs into Airtable, update rows by Jobicy ID and check stored listing statuses. Uses the official [Jobicy JavaScript SDK](https://github.com/Jobicy/jobicy-js), pinned to a reviewed GitHub commit. No Jobicy API key is required.

## Set up your table

Create a dedicated **Jobs** table in an Airtable base. Use the following exact field names:

| Field | Airtable type |
| --- | --- |
| `Jobicy ID` | Single line text; keep each ID unique |
| `Title`, `Company`, `Location`, `Currency`, `Period`, `Status` | Single line text |
| `URL` | URL |
| `Published at`, `Last seen`, `Status checked` | Single line text (ISO date-time values) |
| `Salary min`, `Salary max` | Number, allowing empty values |

Keep personal notes in additional fields: this integration updates only its managed fields. Rows without a Jobicy ID are left untouched. Existing duplicate IDs cause a visible failure before writes. Do not use a formula field for `Jobicy ID`.

Create an [Airtable personal access token](https://airtable.com/create/tokens) with `data.records:read` and `data.records:write` scopes, limited to this base. Copy the base ID (`app...`) from your Airtable base's API documentation. Your Airtable plan's record limits and API quotas apply.

## Run

Requires Node.js 22+.

```bash
git clone https://github.com/Jobicy/jobicy-airtable.git
cd jobicy-airtable
npm ci
cp .env.example .env
# Fill in AIRTABLE_TOKEN and AIRTABLE_BASE_ID.
npm run sync -- --dry-run
```

The dry run reads Jobicy and Airtable and checks statuses, but does not change Airtable rows. It records the successful run locally; wait one hour before a subsequent sync. To apply changes on the next run:

```bash
npm run sync
```

Use a scheduler hourly or less often. For example, replace `/absolute/path/jobicy-airtable` below with your checkout, and ensure cron can find Node:

```cron
0 * * * * cd /absolute/path/jobicy-airtable && npm run sync >> sync.log 2>&1
```

Preserve `data/` between runs. A local lock prevents simultaneous runs in this checkout. Run one worker per table; the lock does not coordinate different machines. If a process crashes, inspect the PID in `data/sync.lock` and remove that file only after confirming the process has stopped. Keep `.env`, logs and tokens outside version control.

## Behavior

Every run traverses the seven-day feed with cursor pagination, reads all existing Airtable pages and checks statuses in batches of up to 100 Jobicy IDs. Feed absence does not close a listing. `active`, `closed` and `unknown` remain separate values. Source URLs are preserved. Optional salaries stay empty when absent.

Airtable writes use PATCH `performUpsert` on `Jobicy ID`, with at most 10 rows per request and at most four requests per second from this client. Network failures and HTTP 429 stop the run; schedule retries with respect to the reported `Retry-After`. Retries use the same IDs instead of creating a new row for every run. Airtable provides no transaction covering all batches: earlier batches may already be applied if a later batch fails. The next run reconciles them. Coordinate all other writers to avoid duplicate IDs.

Optional `.env` filters: `JOBICY_GEO`, `JOBICY_INDUSTRY`, `JOBICY_TAG` (3–50 characters). Find current slugs in the [API documentation](https://github.com/Jobicy/remote-jobs-api). Changing filters retains older rows.

## Verify

```bash
npm test
npm run check
```

Tests run the actual Jobicy and Airtable HTTP clients against local contract fixtures. They cover pagination, older records, status failure and dry-run write suppression. Token permissions, table types and real Airtable quotas must be checked in your own base.

Display **[Jobs powered by Jobicy](https://jobicy.com/)** in public views and preserve original listing URLs. [All integrations](https://github.com/Jobicy/jobicy-api-examples) · [MIT license](LICENSE) · [Data terms](PROVENANCE.md)
