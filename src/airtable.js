import { setTimeout as delay } from 'node:timers/promises';

export class AirtableError extends Error {
  constructor(status, retryAfterSeconds = null) {
    super(`Airtable returned HTTP ${status}; check token scopes, table fields and service limits`);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AirtableClient {
  constructor({ token, baseId, table = 'Jobs', apiUrl = 'https://api.airtable.com/v0', intervalMs = 250 }) {
    if (!token || !/^app[A-Za-z0-9]+$/.test(baseId || '') || !table.trim()) throw new Error('Set AIRTABLE_TOKEN, AIRTABLE_BASE_ID and AIRTABLE_TABLE');
    const endpoint = new URL(apiUrl);
    if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Use HTTPS or a local HTTP test server for Airtable');
    this.url = `${endpoint.href.replace(/\/$/, '')}/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`;
    this.token = token;
    this.intervalMs = Math.max(250, Number(intervalMs) || 250);
    this.previousRequest = 0;
  }

  async request(url, body) {
    await delay(Math.max(0, this.intervalMs - (Date.now() - this.previousRequest)));
    this.previousRequest = Date.now();
    let response;
    try {
      response = await fetch(url, {
        method: body ? 'PATCH' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch { throw new Error('Airtable request failed or timed out'); }
    if (!response.ok) {
      const retry = Number(response.headers.get('retry-after'));
      throw new AirtableError(response.status, retry > 0 && Number.isFinite(retry) ? Math.ceil(retry) : null);
    }
    let payload;
    try { payload = await response.json(); } catch { throw new Error('Airtable returned invalid JSON'); }
    if (!payload || !Array.isArray(payload.records)) throw new Error('Airtable returned no records array');
    return payload;
  }

  async listRows() {
    const rows = []; const offsets = new Set(); let offset;
    do {
      const url = new URL(this.url); url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);
      const page = await this.request(url);
      rows.push(...page.records);
      offset = page.offset;
      if (offset !== undefined && (typeof offset !== 'string' || !offset || offsets.has(offset))) throw new Error('Invalid or repeated Airtable offset');
      if (offset) offsets.add(offset);
    } while (offset);
    return rows;
  }

  async upsert(rows) {
    for (let index = 0; index < rows.length; index += 10) {
      const records = rows.slice(index, index + 10).map((fields) => ({ fields }));
      const result = await this.request(this.url, { performUpsert: { fieldsToMergeOn: ['Jobicy ID'] }, records, typecast: false });
      if (result.records.length !== records.length) throw new Error('Airtable returned an incomplete upsert result');
    }
  }
}
