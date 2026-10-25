export const FIELDS = ['Jobicy ID', 'Title', 'Company', 'Location', 'URL', 'Published at', 'Salary min', 'Salary max', 'Currency', 'Period', 'Status', 'Last seen', 'Status checked'];

export async function synchronize({ jobicy, airtable, filters = {}, dryRun = false, now = new Date().toISOString() }) {
  const jobs = await jobicy.getAllJobs({ count: 100, ...filters });
  const existing = await airtable.listRows();
  const byId = new Map();
  for (const record of existing) {
    const id = record.fields?.['Jobicy ID'];
    if (id == null || id === '') continue; // Keep unrelated rows untouched.
    if (typeof id !== 'string' || !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Jobicy ID must be a text field containing positive safe integer IDs');
    if (byId.has(id)) throw new Error('Duplicate Jobicy ID in Airtable; resolve it before synchronization');
    byId.set(id, Object.fromEntries(FIELDS.filter((key) => key in record.fields).map((key) => [key, record.fields[key]])));
  }
  for (const job of jobs) {
    const id = String(job.id);
    if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid job ID');
    const amount = (value) => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
    byId.set(id, {
      ...byId.get(id), 'Jobicy ID': id, Title: String(job.jobTitle || ''), Company: String(job.companyName || ''),
      Location: String(job.jobGeo || ''), URL: job.url, 'Published at': String(job.pubDate || ''),
      'Salary min': amount(job.salaryMin), 'Salary max': amount(job.salaryMax), Currency: String(job.salaryCurrency || ''),
      Period: String(job.salaryPeriod || ''), 'Last seen': now
    });
  }
  const rows = [...byId.values()];
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    const statuses = await jobicy.getJobStatuses(batch.map((row) => row['Jobicy ID']));
    const map = new Map(statuses.map((item) => [String(item.id), item.status]));
    for (const row of batch) {
      if (!map.has(row['Jobicy ID'])) throw new Error('Missing job status');
      row.Status = map.get(row['Jobicy ID']); row['Status checked'] = now;
    }
  }
  // No Airtable mutation occurs until the feed, table read, and status checks all succeed.
  if (!dryRun) await airtable.upsert(rows);
  return { feedJobs: jobs.length, managedRows: rows.length, dryRun };
}
