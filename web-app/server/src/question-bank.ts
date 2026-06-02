import fs from 'node:fs';
import path from 'node:path';
import type { QuestionBankHit } from '@open-cluely/contract';
import { createRetriever } from '@open-cluely/question-bank';
import { config } from './config';

// ---------------------------------------------------------------------------
// Lazy singletons over the question bank.
//   - getBank()      loads data/bank.json once (direct browse, no embeddings)
//   - getRetriever() builds the semantic retriever once (needs an API key)
// Both resolve the package's data dir off its installed location so this keeps
// working under a `file:`-linked install.
// ---------------------------------------------------------------------------

interface BankItem {
  question: string;
  companies: string[];
  subcategories: string[];
  difficulty: number;
  vote: number;
  url: string;
}

interface BankFile {
  dim: number;
  model: string;
  count: number;
  builtAt: string;
  items: BankItem[];
}

interface Retriever {
  retrieve(args: { queryText: string; topK?: number }): Promise<QuestionBankHit[]>;
  isReady(): boolean;
}

function resolveDataDir(): string {
  // package.json is always present; its dirname + /data is the data folder.
  const pkgJson = require.resolve('@open-cluely/question-bank/package.json');
  return path.join(path.dirname(pkgJson), 'data');
}

let bankCache: BankFile | null = null;

export function getBank(): BankFile {
  if (bankCache) return bankCache;
  const bankPath = path.join(resolveDataDir(), 'bank.json');
  const raw = fs.readFileSync(bankPath, 'utf8');
  const parsed = JSON.parse(raw) as BankFile;
  bankCache = {
    dim: parsed.dim,
    model: parsed.model,
    count: typeof parsed.count === 'number' ? parsed.count : parsed.items.length,
    builtAt: parsed.builtAt,
    items: Array.isArray(parsed.items) ? parsed.items : []
  };
  return bankCache;
}

let retrieverCache: Retriever | null = null;

export function getRetriever(): Retriever {
  if (retrieverCache) return retrieverCache;
  retrieverCache = createRetriever({
    dataDir: resolveDataDir(),
    apiKey: config.dashscopeApiKey
  }) as Retriever;
  return retrieverCache;
}

// --- Browse helpers (pure, operate on the loaded bank) ---------------------

export interface CompanyCount {
  name: string;
  count: number;
}

/** Count questions per company across items[].companies, sorted by count desc. */
export function listCompanies(): CompanyCount[] {
  const bank = getBank();
  const counts = new Map<string, number>();
  for (const item of bank.items) {
    for (const company of item.companies ?? []) {
      counts.set(company, (counts.get(company) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface QuestionFilter {
  company?: string;
  difficulty?: number;
  q?: string;
  page: number;
  pageSize: number;
}

export interface QuestionPage {
  total: number;
  page: number;
  pageSize: number;
  items: QuestionBankHit[];
}

/** Filter bank items (no embeddings) by company / difficulty / substring, then paginate. */
export function filterQuestions(filter: QuestionFilter): QuestionPage {
  const bank = getBank();
  const needle = filter.q?.trim().toLowerCase() ?? '';

  const matched = bank.items.filter((item) => {
    if (filter.company && !(item.companies ?? []).includes(filter.company)) return false;
    if (typeof filter.difficulty === 'number' && item.difficulty !== filter.difficulty) return false;
    if (needle && !String(item.question ?? '').toLowerCase().includes(needle)) return false;
    return true;
  });

  const total = matched.length;
  const start = (filter.page - 1) * filter.pageSize;
  const items: QuestionBankHit[] = matched.slice(start, start + filter.pageSize).map((item) => ({
    question: item.question,
    companies: item.companies ?? [],
    subcategories: item.subcategories ?? [],
    difficulty: item.difficulty,
    vote: item.vote,
    url: item.url ?? '',
    score: 0
  }));

  return { total, page: filter.page, pageSize: filter.pageSize, items };
}

export function isQuestionBankReady(): boolean {
  try {
    return getBank().items.length > 0;
  } catch {
    return false;
  }
}
