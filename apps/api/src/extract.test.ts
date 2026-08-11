import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchQueries,
  domainAllowed,
  extractEmailsFromText,
  normalizeHtmlForEmails,
  parseDomains,
  parseUrlList,
} from './extract.js';
import { resolveGeo } from './geo.js';

describe('parseDomains', () => {
  it('rejects bare TLDs and normalizes www/schemes', () => {
    assert.deepEqual(parseDomains('gmail.com, com, www.yahoo.com, https://outlook.com/path'), [
      'gmail.com',
      'yahoo.com',
      'outlook.com',
    ]);
  });
});

describe('domainAllowed', () => {
  it('matches exact and subdomains only', () => {
    assert.equal(domainAllowed('gmail.com', ['gmail.com']), true);
    assert.equal(domainAllowed('mail.company.com', ['company.com']), true);
    assert.equal(domainAllowed('gmail.com', ['com']), false);
    assert.equal(domainAllowed('notgmail.com', ['gmail.com']), false);
  });
});

describe('extractEmailsFromText', () => {
  it('decodes entities and obfuscation', () => {
    const html = `
      <p>Reach us at sales&#64;acme.com</p>
      <p>Also hello [at] brand [dot] org</p>
      <script>var x = "ignore@evil.com"</script>
    `;
    const emails = extractEmailsFromText(html, 'https://acme.com', ['acme.com', 'brand.org']);
    const set = new Set(emails.map((e) => e.email));
    assert.ok(set.has('sales@acme.com'));
    assert.ok(set.has('hello@brand.org'));
    assert.ok(!set.has('ignore@evil.com'));
  });
});

describe('normalizeHtmlForEmails', () => {
  it('strips scripts', () => {
    const out = normalizeHtmlForEmails('<script>a@b.com</script>hi');
    assert.ok(!out.includes('a@b.com'));
  });
});

describe('resolveGeo', () => {
  it('maps Lagos to Nigeria google domain', () => {
    const g = resolveGeo('Lagos');
    assert.equal(g.gl, 'ng');
    assert.equal(g.google_domain, 'google.com.ng');
  });

  it('maps London to UK', () => {
    const g = resolveGeo('London, UK');
    assert.equal(g.gl, 'gb');
  });
});

describe('buildSearchQueries', () => {
  it('quotes multi-word locations', () => {
    const qs = buildSearchQueries('CEO', 'New York', ['gmail.com']);
    assert.ok(qs.some((q) => q.includes('"New York"')));
  });

  it('includes Sniffy query variants', () => {
    const qs = buildSearchQueries('realtor', 'Texas', ['gmail.com'], 'full');
    assert.ok(qs.some((q) => q.includes('inurl:contact')));
    assert.ok(qs.some((q) => q.includes('"team" OR "staff"')));
    assert.ok(qs.some((q) => q.includes('filetype:pdf')));
  });

  it('builds simple free-tier safe queries', () => {
    const qs = buildSearchQueries('school', 'San Jose, CA', [], 'simple');
    assert.ok(qs.some((q) => q.includes('contact email')));
    assert.ok(!qs.some((q) => /inurl:|filetype:|\bOR\b/.test(q)));
  });
});

describe('parseUrlList', () => {
  it('accepts bare domains', () => {
    assert.deepEqual(parseUrlList('example.com/team\nhttps://ok.com'), [
      'https://example.com/team',
      'https://ok.com/',
    ]);
  });
});
