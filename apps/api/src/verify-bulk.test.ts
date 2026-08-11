import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmailList, verifyOneEmail } from './verify-bulk.js';

describe('verify-bulk Hazmat-style', () => {
  it('parseEmailList dedupes and splits lines', () => {
    const list = parseEmailList('a@b.com\nA@B.com, c@d.org; junk\n');
    assert.deepEqual(list, ['a@b.com', 'c@d.org']);
  });

  it('parseEmailList pulls emails from CSV / free text', () => {
    const list = parseEmailList('Name,Email\nAda,ada@corp.io\nBob bob@corp.io phone');
    assert.ok(list.includes('ada@corp.io'));
    assert.ok(list.includes('bob@corp.io'));
  });

  it('rejects role / generic mailboxes as invalid', async () => {
    const row = await verifyOneEmail('info@example.com', { smtp: false });
    assert.equal(row.bucket, 'invalid');
    assert.match(row.reason, /role/i);
  });

  it('rejects bad syntax', async () => {
    const row = await verifyOneEmail('not-an-email', { smtp: false });
    assert.equal(row.bucket, 'invalid');
  });
});
