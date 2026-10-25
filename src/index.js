import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { JobicyClient } from '@jobicy/jobs';
import { AirtableClient } from './airtable.js';
import { synchronize } from './sync.js';

try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== '--dry-run')) throw new Error('Usage: npm run sync -- [--dry-run]');
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
const directory = new URL('../data/', import.meta.url);
const lock = new URL('sync.lock', directory);
let handle;
try {
  handle = await open(lock, 'wx', 0o600);
  await handle.writeFile(String(process.pid));
  let previous = {};
  try { previous = JSON.parse(await readFile(new URL('state.json', directory), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid sync state; inspect data/state.json'); }
  if (previous.completedAt && Date.now() - Date.parse(previous.completedAt) < 3600000) {
    console.log('Skipped: less than one hour since the previous successful run.');
  } else {
    const result = await synchronize({
      jobicy: new JobicyClient(),
      airtable: new AirtableClient({ token: process.env.AIRTABLE_TOKEN, baseId: process.env.AIRTABLE_BASE_ID, table: process.env.AIRTABLE_TABLE || 'Jobs' }),
      filters: { geo: process.env.JOBICY_GEO || '', industry: process.env.JOBICY_INDUSTRY || '', tag: process.env.JOBICY_TAG || '' },
      dryRun: flags.includes('--dry-run')
    });
    const temporary = new URL('state.tmp', directory);
    await writeFile(temporary, JSON.stringify({ completedAt: new Date().toISOString() }), { mode: 0o600 });
    await rename(temporary, new URL('state.json', directory));
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Another run holds data/sync.lock. Inspect that process before removing a stale lock.' : error.message);
  process.exitCode = 1;
} finally {
  if (handle) { await handle.close(); await unlink(lock); }
}
