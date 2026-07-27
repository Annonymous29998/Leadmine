import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { leadQualityScore, isValidEmailSyntax, validateEmailAddress } from './validate.js';
import { domainAllowed, extractEmailsFromText } from './extract.js';
import { isBlockedUrl } from './search.js';
import { runExtraction } from './extract-job.js';
import { saveJobResults, type JobState } from './jobs.js';
import { readFileSync, rmSync } from 'node:fs';

describe('leadQualityScore (Sniffy ≥60)', () => {
  it('scores person-like emails highly', () => {
    assert.ok(leadQualityScore('john.doe@gmail.com') >= 60);
    assert.ok(leadQualityScore('jane@yahoo.com') >= 60);
  });

  it('rejects role / noreply below threshold', () => {
    assert.ok(leadQualityScore('info@acme.com') < 60);
    assert.equal(leadQualityScore('noreply@x.com'), 0);
    assert.ok(!isValidEmailSyntax('noreply@x.com') || leadQualityScore('noreply@x.com') < 60);
  });

  it('rejects placeholders', () => {
    assert.ok(leadQualityScore('user@example.com') < 60 || !isValidEmailSyntax('user@example.com'));
  });
});

describe('domainAllowed empty = no filter (Sniffy optional)', () => {
  it('allows any domain when filter is empty', () => {
    assert.equal(domainAllowed('anything.io', []), true);
    const hits = extractEmailsFromText(
      'Contact: alice.smith@randomcorp.io',
      'https://x.test',
      [],
    );
    assert.ok(hits.some((e) => e.email === 'alice.smith@randomcorp.io'));
  });
});

describe('isBlockedUrl', () => {
  it('blocks social / aggregator hosts', () => {
    assert.equal(isBlockedUrl('https://www.linkedin.com/in/foo'), true);
    assert.equal(isBlockedUrl('https://facebook.com/page'), true);
    assert.equal(isBlockedUrl('https://example.com/contact'), false);
  });
});

describe('validateEmailAddress', () => {
  it('flags low-quality leads', async () => {
    const res = await validateEmailAddress('info@example.com');
    assert.equal(res.ok, false);
    assert.ok(res.reason.includes('low lead quality') || res.reason.includes('MX') || res.reason.includes('syntax'));
  });
});

describe('saveJobResults Sniffy format', () => {
  it('writes legitimate_emails with score >= 60 header', () => {
    const job: JobState = {
      id: 'test',
      status: 'completed',
      progress: 100,
      stats: { pages_crawled: 1, pages_failed: 0, emails_found: 2, leads_found: 2 },
      currently_crawling: [],
      results: [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          source_page: 'LeadMine Crawl: https://a.test',
          type: 'email',
          value: 'john.doe@gmail.com',
          score: 95,
        },
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          source_page: 'LeadMine Crawl: https://a.test',
          type: 'email',
          value: 'info@acme.com',
          score: 40,
        },
      ],
      new_results: [],
      logs: [],
      startedAt: new Date().toISOString(),
    };

    const { files } = saveJobResults(job);
    assert.ok(files.length >= 2);
    const legit = files.find((f) => f.includes('legitimate_emails_'));
    assert.ok(legit);
    const text = readFileSync(legit!, 'utf8');
    assert.ok(text.includes('# Legitimate Emails (Score >= 60)'));
    assert.ok(text.includes('john.doe@gmail.com (95)'));
    assert.ok(!text.includes('info@acme.com'));

    for (const f of files) {
      try {
        rmSync(f);
      } catch {
        /* ignore */
      }
    }
  });
});

describe('e2e: URL / file extraction (no SerpAPI)', () => {
  it('extracts and validates from local HTML with empty domain filter', async () => {
    const result = await runExtraction(
      {
        subject: 'smoke',
        location: '',
        domains: '',
        maxResults: 5,
        mode: 'urls',
        fileContent: `
          <html><body>
            <a href="mailto:jane.doe@gmail.com">Jane</a>
            <p>Also: john.smith@yahoo.com</p>
            <p>Skip: info@example.com</p>
          </body></html>
        `,
        fileName: 'smoke.html',
      },
      { cancelled: () => false },
    );

    assert.ok(result.emails.length >= 1);
    assert.ok(result.emails.every((e) => leadQualityScore(e.email) >= 60));
    const set = new Set(result.emails.map((e) => e.email));
    assert.ok(set.has('jane.doe@gmail.com') || set.has('john.smith@yahoo.com'));
    assert.ok(!set.has('info@example.com'));
  });

  it('SSRF guard blocks private loopback crawl targets', async () => {
    const result = await runExtraction(
      {
        subject: 'ssrf',
        location: '',
        domains: 'gmail.com',
        maxResults: 3,
        mode: 'urls',
        urlList: 'http://127.0.0.1:9/contact',
        maxDepth: 1,
      },
      { cancelled: () => false },
    );
    // Should not crash; private IP fetches fail and yield no emails
    assert.equal(result.emails.length, 0);
    assert.ok(result.logs.some((l) => /private IP|blocked|Failed/i.test(l.message)));
  });
});
