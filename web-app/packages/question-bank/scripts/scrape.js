'use strict';

/**
 * Scrapes the osjobs.net public interview-question API for a fixed list of
 * companies, dedups questions across companies by exact question_text, and
 * writes data/bank.raw.json.
 *
 * Run: npm run scrape   (network required, no auth)
 */

const fs = require('node:fs');
const path = require('node:path');

const API_BASE = 'https://osjobs.net/topk/api';
const USER_AGENT = 'Mozilla/5.0';
const REQUEST_DELAY_MS = 150;
const MAX_RETRIES = 3;
const DATA_DIR = path.join(__dirname, '..', 'data');

// Companies to scrape (Chinese names). encodeURIComponent handles URL encoding.
const COMPANIES = [
  '谷歌', '脸书', '苹果', '亚马逊', '腾讯', '阿里', '字节跳动',
  'Shopee', '美团', '滴滴', '百度', '京东', '快手', '拼多多',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch JSON with polite delay, retry (up to MAX_RETRIES) and exponential backoff.
 * Throws after exhausting retries; callers decide whether to skip.
 */
async function fetchJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const backoff = REQUEST_DELAY_MS * Math.pow(2, attempt); // 300, 600, ...
        console.warn(`  retry ${attempt}/${MAX_RETRIES - 1} for ${url} after ${backoff}ms (${err.message})`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

function subcategoryUrl(company) {
  return `${API_BASE}/subcategory.json?category=${encodeURIComponent(company)}`;
}

function questionUrl(company, subId) {
  return `${API_BASE}/question.json?category=${encodeURIComponent(company)}&sub_category=${subId}`;
}

/**
 * Check category.json for any company names not in our scrape list, and log them.
 */
async function reportUnknownCompanies() {
  try {
    const data = await fetchJson(`${API_BASE}/category.json`);
    const listed = (data.results || []).map((r) => r.category_name).filter(Boolean);
    const known = new Set(COMPANIES);
    const missing = listed.filter((name) => !known.has(name));
    if (missing.length > 0) {
      console.log(`\nNOTE: category.json lists ${missing.length} company name(s) NOT in our scrape list: ${missing.join(', ')}`);
    } else {
      console.log('\nNOTE: every company in category.json is already in our scrape list.');
    }
    await sleep(REQUEST_DELAY_MS);
  } catch (err) {
    console.warn(`Could not fetch category.json (non-fatal): ${err.message}`);
  }
}

/**
 * Scrape one company. Returns array of raw question records (one per question per sub).
 * Failures within a company are logged and skipped, never thrown.
 */
async function scrapeCompany(company) {
  const collected = [];
  let subs;
  try {
    const subData = await fetchJson(subcategoryUrl(company));
    await sleep(REQUEST_DELAY_MS);
    subs = subData.results?.[0]?.sub_category || [];
  } catch (err) {
    console.warn(`SKIP company "${company}" — subcategory fetch failed: ${err.message}`);
    return collected;
  }

  for (const sub of subs) {
    const subId = sub.id;
    const subName = sub.category_name || sub.category_text || String(subId);
    try {
      const qData = await fetchJson(questionUrl(company, subId));
      await sleep(REQUEST_DELAY_MS);
      const questions = qData.results || [];
      for (const q of questions) {
        const text = (q.question_text || '').trim();
        if (!text) continue;
        collected.push({
          question: text,
          company,
          subcategory: subName,
          difficulty: q.difficulty,
          vote: typeof q.vote === 'number' ? q.vote : 0,
          url: (q.question_url || '').trim(),
          resources: [q.resource1, q.resource2, q.resource3]
            .map((r) => (r || '').trim())
            .filter(Boolean),
        });
      }
    } catch (err) {
      console.warn(`  SKIP "${company}" / sub ${subId} (${subName}) — question fetch failed: ${err.message}`);
    }
  }
  return collected;
}

/**
 * Dedup raw records across companies by exact question text.
 * Merge: max vote, union of companies, union of subcategories,
 * first non-empty url, union of non-empty resources into refs[].
 */
function dedup(rawRecords) {
  const byText = new Map();
  for (const rec of rawRecords) {
    const existing = byText.get(rec.question);
    if (!existing) {
      byText.set(rec.question, {
        question: rec.question,
        companies: new Set([rec.company]),
        subcategories: new Set(rec.subcategory ? [rec.subcategory] : []),
        difficulty: rec.difficulty,
        vote: rec.vote,
        url: rec.url,
        refs: new Set(rec.resources),
      });
    } else {
      existing.companies.add(rec.company);
      if (rec.subcategory) existing.subcategories.add(rec.subcategory);
      existing.vote = Math.max(existing.vote, rec.vote);
      if (!existing.url && rec.url) existing.url = rec.url;
      // Prefer a defined difficulty if the first seen was missing.
      if ((existing.difficulty === undefined || existing.difficulty === null) && rec.difficulty != null) {
        existing.difficulty = rec.difficulty;
      }
      for (const r of rec.resources) existing.refs.add(r);
    }
  }

  return Array.from(byText.values()).map((item) => ({
    question: item.question,
    companies: Array.from(item.companies),
    subcategories: Array.from(item.subcategories),
    difficulty: item.difficulty,
    vote: item.vote,
    url: item.url,
    refs: Array.from(item.refs),
  }));
}

async function main() {
  console.log(`Scraping ${COMPANIES.length} companies from ${API_BASE} ...\n`);

  await reportUnknownCompanies();

  const allRaw = [];
  const perCompanyCounts = {};

  for (const company of COMPANIES) {
    process.stdout.write(`Scraping ${company} ... `);
    const records = await scrapeCompany(company);
    perCompanyCounts[company] = records.length;
    allRaw.push(...records);
    console.log(`${records.length} questions`);
  }

  const items = dedup(allRaw);

  // Sort deterministically: highest vote first, then question text.
  items.sort((a, b) => (b.vote - a.vote) || a.question.localeCompare(b.question));

  const output = {
    scrapedAt: new Date().toISOString(),
    count: items.length,
    items,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outPath = path.join(DATA_DIR, 'bank.raw.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log('\n===== SCRAPE SUMMARY =====');
  console.log(`Total raw questions (with duplicates): ${allRaw.length}`);
  console.log(`Deduped unique questions:              ${items.length}`);
  console.log('Per-company counts:');
  for (const company of COMPANIES) {
    console.log(`  ${company.padEnd(12)} ${perCompanyCounts[company]}`);
  }
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error('Fatal scrape error:', err);
  process.exit(1);
});
