import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { JobicyClient } from '@jobicy/jobs';
import { AirtableClient } from '../src/airtable.js';
import { synchronize } from '../src/sync.js';

test('real HTTP synchronization retains old jobs, pages the feed and upserts by text ID', async (t) => {
  const writes = []; const paths = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); paths.push(url.pathname + url.search);
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/jobs') return res.end(JSON.stringify({ jobs: [{ id: url.searchParams.has('cursor') ? 2 : 1, url: 'https://jobicy.com/jobs/1' }], nextCursor: url.searchParams.has('cursor') ? null : 'opaque+/=', hasMore: !url.searchParams.has('cursor') }));
    if (url.pathname === '/api/jobs/status') {
      const jobs = url.searchParams.get('ids').split(',').map((id) => ({ id: Number(id), status: id === '99' ? 'unknown' : 'active' }));
      return res.end(JSON.stringify({ success: true, count: jobs.length, jobs }));
    }
    assert.equal(req.headers.authorization, 'Bearer test-only-token');
    if (req.method === 'GET') return res.end(JSON.stringify({ records: [{ id: 'recOld', fields: { 'Jobicy ID': '99', Title: 'Older job', Status: 'active' } }] }));
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); writes.push(payload);
    res.end(JSON.stringify({ records: payload.records }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const host = `http://127.0.0.1:${server.address().port}`;
  const options = { jobicy: new JobicyClient({ apiUrl: host + '/api/jobs' }), airtable: new AirtableClient({ token: 'test-only-token', baseId: 'appTest', apiUrl: host + '/v0' }) };
  const result = await synchronize(options);
  assert.equal(result.managedRows, 3);
  assert.deepEqual(writes[0].performUpsert.fieldsToMergeOn, ['Jobicy ID']);
  assert.equal(writes[0].records[0].fields.Status, 'unknown');
  assert(paths.some((path) => path.includes('cursor=opaque%2B%2F%3D')));
  await synchronize({ ...options, dryRun: true });
  assert.equal(writes.length, 1, 'dry run makes no Airtable mutations');
});

test('status failure prevents writes and duplicate remote IDs are rejected', async () => {
  let writes = 0;
  const airtable = { listRows: async () => [{ fields: { 'Jobicy ID': '1' } }], upsert: async () => { writes++; } };
  const jobicy = { getAllJobs: async () => [], getJobStatuses: async () => { throw new Error('HTTP 429'); } };
  await assert.rejects(synchronize({ airtable, jobicy }), /429/);
  assert.equal(writes, 0);
  airtable.listRows = async () => [{ fields: { 'Jobicy ID': '1' } }, { fields: { 'Jobicy ID': '1' } }];
  await assert.rejects(synchronize({ airtable, jobicy }), /Duplicate/);
});
