import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchQueries,
  crawlHostAllowed,
  domainAllowed,
  extractEmailsFromText,
  isCompanyOnlyFilter,
  isExactCompanyHostFilter,
  normalizeHtmlForEmails,
  parseDomainFilter,
  parseDomains,
  parseUrlList,
  emailMatchesFilter,
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

describe('parseDomainFilter', () => {
  it('empty = any', () => {
    assert.equal(parseDomainFilter('').mode, 'any');
  });

  it('company.com means all corporate emails, not the domain company.com', () => {
    const f = parseDomainFilter('company.com');
    assert.equal(f.mode, 'corporate');
    assert.deepEqual(f.domains, []);
    assert.equal(emailMatchesFilter('acme.io', f), true);
    assert.equal(emailMatchesFilter('gmail.com', f), false);
    assert.equal(emailMatchesFilter('yahoo.com', f), false);
  });

  it('gmail/yahoo are exact', () => {
    const f = parseDomainFilter('gmail.com, yahoo.com');
    assert.equal(f.mode, 'exact');
    assert.deepEqual(f.domains, ['gmail.com', 'yahoo.com']);
    assert.equal(emailMatchesFilter('gmail.com', f), true);
    assert.equal(emailMatchesFilter('acme.com', f), false);
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
      <p>Reach jane.doe&#64;acme.com or sales&#64;acme.com</p>
      <p>Also mary.smith [at] brand [dot] org</p>
      <script>var x = "ignore@evil.com"</script>
    `;
    const emails = extractEmailsFromText(html, 'https://acme.com', ['acme.com', 'brand.org']);
    const set = new Set(emails.map((e) => e.email));
    assert.ok(set.has('jane.doe@acme.com'));
    assert.ok(set.has('mary.smith@brand.org'));
    assert.ok(!set.has('sales@acme.com'));
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

  it('maps Philadelphia, PA, USA to SerpAPI canonical location', () => {
    const g = resolveGeo('Philadelphia, PA, USA');
    assert.equal(g.gl, 'us');
    assert.equal(g.location, 'Philadelphia,Pennsylvania,United States');
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
    assert.ok(qs.some((q) => q.includes('gmail.com')));
    assert.ok(qs.some((q) => q.includes('outlook.com')));
    assert.ok(!qs.some((q) => /inurl:|filetype:|\bOR\b/.test(q)));
  });

  it('simple queries target exact domains when filter is set', () => {
    const qs = buildSearchQueries('CEO', 'Lagos', ['outlook.com', 'hotmail.com'], 'simple');
    assert.ok(qs.some((q) => q.includes('outlook.com')));
    assert.ok(qs.some((q) => q.includes('hotmail.com')));
    assert.ok(!qs.some((q) => q.includes('gmail.com')));
    assert.ok(!qs.some((q) => /"@/.test(q)), 'should not use quoted @domain (Serper free blocks)');
  });

  it('simple ISP queries hunt @comcast.net not brand contact pages', () => {
    const qs = buildSearchQueries('homeowner', 'Philadelphia, PA, USA', ['comcast.net'], 'simple');
    assert.ok(qs.some((q) => q.includes('@comcast.net')));
    assert.ok(qs.some((q) => q.includes('directory') || q.includes('hoa')));
    assert.ok(!qs.some((q) => /comcast\.net contact$/i.test(q)));
  });

  it('simple queries for corporate mode avoid free-webmail hunts', () => {
    const qs = buildSearchQueries('CEO', 'Lagos', parseDomainFilter('company.com'), 'simple');
    assert.ok(qs.some((q) => q.includes('contact email') || q.includes('company email')));
    assert.ok(!qs.some((q) => q.includes('gmail.com')));
  });
});

describe('crawlHostAllowed', () => {
  it('allows any host when filter empty or includes free webmail', () => {
    assert.equal(crawlHostAllowed('random.org', []), true);
    assert.equal(isCompanyOnlyFilter(['outlook.com']), false);
    assert.equal(crawlHostAllowed('news.site', ['outlook.com']), true);
    assert.equal(isCompanyOnlyFilter(['comcast.net']), false);
    assert.equal(crawlHostAllowed('directory.example', ['comcast.net']), true);
  });

  it('restricts crawl to company domain hosts when filter is company-only', () => {
    assert.equal(isExactCompanyHostFilter({ mode: 'exact', domains: ['acme.com'] }), true);
    assert.equal(crawlHostAllowed('acme.com', ['acme.com']), true);
    assert.equal(crawlHostAllowed('www.acme.com', ['acme.com']), true);
    assert.equal(crawlHostAllowed('other.com', ['acme.com']), false);
  });

  it('corporate mode does not restrict crawl hosts', () => {
    const f = parseDomainFilter('company.com');
    assert.equal(f.mode, 'corporate');
    assert.equal(crawlHostAllowed('random.org', f), true);
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
