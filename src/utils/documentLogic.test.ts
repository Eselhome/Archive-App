import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  CategoryRecord,
  DocumentFilterState,
  DocumentRecord,
  InvestmentRecord,
} from '../types';
import {
  buildCombinedPortfolioSeries,
  buildPreviewSummary,
  computeDocumentStats,
  computePortfolioSummary,
  exportDocumentsToCsv,
  filterDocuments,
  formatCurrencyCents,
  formatGermanDate,
  parseOptionalEuroInputToCents,
  searchOverviewDocuments,
  sortDocuments,
  validateDocumentInput,
} from './documentLogic';

const sampleDocs: DocumentRecord[] = [
  {
    id: 'doc-1',
    title: 'MacBook Pro M4 Online-Kaufbeleg',
    doc_type: 'Kaufbeleg',
    vendor: 'Apple Store Deutschland',
    doc_number: 'W94827104',
    doc_date: '2026-10-18',
    amount_cents: 239900,
    tax_cents: 38303,
    currency: 'EUR',
    category_id: 'cat-purchases',
    category_name: 'Online-Käufe',
    parent_id: null,
    parent_title: null,
    status: 'Archiviert',
    summary: 'PDF-Kaufbeleg für MacBook Pro 14 Zoll inkl. 2 Jahre Gewährleistung.',
    ai_summary: '',
    extracted_text: 'Apple Store Bestellnummer W94827104 MacBook Pro 14 M4 16GB 1TB 2.399,00 EUR',
    line_items: [{ description: 'MacBook Pro 14" M4', totalCents: 239900 }],
    tags: ['Hardware', 'Garantie'],
    file_url: null,
    file_name: null,
    file_mime: null,
    created_at: '2026-10-18T10:00:00Z',
    updated_at: '2026-10-18T10:00:00Z',
  },
  {
    id: 'doc-2',
    title: 'Wertpapierdepot & ETF-Sparplan Vertrag',
    doc_type: 'Vertrag',
    vendor: 'Scalable Capital Broker',
    doc_number: 'SC-DEP-4410',
    doc_date: '2025-01-10',
    amount_cents: null,
    tax_cents: null,
    currency: 'EUR',
    category_id: 'cat-investments',
    category_name: 'Investments & Depots',
    parent_id: null,
    parent_title: null,
    status: 'Aktiv',
    summary: 'Rahmenvertrag für monatliche ETF-Sparpläne (MSCI World & FTSE All-World).',
    ai_summary: '',
    extracted_text: 'Depotvertrag SC-DEP-4410 Baader Bank ETF Sparplan MSCI World IE00B4L5Y983',
    line_items: [],
    tags: ['Depot', 'ETF', 'Vertrag'],
    file_url: null,
    file_name: null,
    file_mime: null,
    created_at: '2025-01-10T09:00:00Z',
    updated_at: '2025-01-10T09:00:00Z',
  },
  {
    id: 'doc-3',
    title: 'Monatlicher Depotauszug Oktober 2026',
    doc_type: 'Monatsbeleg',
    vendor: 'Scalable Capital Broker',
    doc_number: 'SC-2026-10',
    doc_date: '2026-11-01',
    amount_cents: 50000,
    tax_cents: 0,
    currency: 'EUR',
    category_id: 'cat-investments',
    category_name: 'Investments & Depots',
    parent_id: 'doc-2',
    parent_title: 'Wertpapierdepot & ETF-Sparplan Vertrag',
    status: 'Archiviert',
    summary: 'Monatliche Sparplanausführung: 300 € MSCI World und 200 € FTSE All-World.',
    ai_summary: '',
    extracted_text: 'Sparplanausführung Oktober 2026 EUNL MSCI World 300 EUR VWCE FTSE All-World 200 EUR',
    line_items: [
      { description: 'Sparplan iShares Core MSCI World', totalCents: 30000 },
      { description: 'Sparplan Vanguard FTSE All-World', totalCents: 20000 },
    ],
    tags: ['Depotauszug', 'Oktober'],
    file_url: null,
    file_name: null,
    file_mime: null,
    created_at: '2026-11-01T08:00:00Z',
    updated_at: '2026-11-01T08:00:00Z',
  },
  {
    id: 'doc-4',
    title: 'Arbeitszeugnis Senior Software Engineer',
    doc_type: 'Zeugnis',
    vendor: 'Nordlicht Systems GmbH',
    doc_number: 'AZ-2024-09',
    doc_date: '2024-09-30',
    amount_cents: null,
    tax_cents: null,
    currency: 'EUR',
    category_id: 'cat-certificates',
    category_name: 'Zeugnisse & Urkunden',
    parent_id: null,
    parent_title: null,
    status: 'Archiviert',
    summary: 'Qualifiziertes Arbeitszeugnis mit Gesamtbewertung „stets zur vollsten Zufriedenheit“.',
    ai_summary: '',
    extracted_text: 'Arbeitszeugnis Nordlicht Systems GmbH stets zur vollsten Zufriedenheit TypeScript Node.js',
    line_items: [],
    tags: ['Karriere', 'Zeugnis'],
    file_url: null,
    file_name: null,
    file_mime: null,
    created_at: '2024-09-30T12:00:00Z',
    updated_at: '2024-09-30T12:00:00Z',
  },
];

const defaultFilter: DocumentFilterState = {
  query: '',
  docType: 'Alle',
  categoryId: 'Alle',
  status: 'Alle',
  dateFrom: '',
  dateTo: '',
};

test('formatCurrencyCents renders null as em dash for contracts/certificates', () => {
  assert.equal(formatCurrencyCents(null), '—');
  const formatted = formatCurrencyCents(239900, 'EUR').replace(/\u00a0/g, ' ');
  assert.equal(formatted, '2.399,00 €');
});

test('parseOptionalEuroInputToCents returns null on blank input', () => {
  assert.equal(parseOptionalEuroInputToCents(''), null);
  assert.equal(parseOptionalEuroInputToCents('  '), null);
  assert.equal(parseOptionalEuroInputToCents('129,50'), 12950);
});

test('filterDocuments searches across parent contract title, extracted text, and doc types', () => {
  const byFulltext = filterDocuments(sampleDocs, { ...defaultFilter, query: 'Zufriedenheit' });
  assert.equal(byFulltext.length, 1);
  assert.equal(byFulltext[0].id, 'doc-4');

  const byType = filterDocuments(sampleDocs, { ...defaultFilter, docType: 'Vertrag' });
  assert.equal(byType.length, 1);
  assert.equal(byType[0].id, 'doc-2');
});

test('sortDocuments handles nullable amounts cleanly', () => {
  const byAmountDesc = sortDocuments(sampleDocs, 'amount_cents', 'desc');
  assert.equal(byAmountDesc[0].id, 'doc-1');
  assert.equal(byAmountDesc[1].id, 'doc-3');
});

test('computeDocumentStats summarizes archive counts without cost calculations', () => {
  const stats = computeDocumentStats(sampleDocs);
  assert.equal(stats.totalCount, 4);
  assert.equal(stats.contractCount, 1);
  assert.equal(stats.monthlyCount, 1);
  assert.equal(stats.certificateCount, 1);
});

test('buildPreviewSummary extracts search hits and headline', () => {
  const summaryCert = buildPreviewSummary(sampleDocs[3], 'TypeScript');
  assert.ok(summaryCert.matchedExcerpts.some((m) => m.snippet.includes('TypeScript')));
  assert.ok(summaryCert.headline.includes('Arbeitszeugnis'));

  const summaryPurchase = buildPreviewSummary(sampleDocs[0], 'MacBook');
  assert.ok(summaryPurchase.matchedExcerpts.length > 0);
});

test('validateDocumentInput allows null amount_cents for contracts and certificates', () => {
  const errors = validateDocumentInput({
    title: 'Arbeitszeugnis',
    vendor: 'Firma GmbH',
    doc_date: '2026-05-01',
    amount_cents: null,
    category_id: 'cat-certificates',
  });
  assert.deepEqual(errors, {});
});

test('computePortfolioSummary and buildCombinedPortfolioSeries calculate ETF performance', () => {
  const investments: InvestmentRecord[] = [
    {
      id: 'inv-1',
      name: 'iShares Core MSCI World',
      symbol: 'EUNL.DE',
      isin: 'IE00B4L5Y983',
      asset_type: 'ETF',
      contract_id: 'doc-2',
      shares: 100,
      avg_buy_price_cents: 8000,
      current_price_cents: 10000,
      currency: 'EUR',
      monthly_savings_cents: 30000,
      last_updated: '2026-11-17T08:00:00Z',
      price_source: 'Kursverlauf',
      history: [
        { date: '2026-09-01', priceCents: 9000 },
        { date: '2026-10-01', priceCents: 9500 },
        { date: '2026-11-17', priceCents: 10000 },
      ],
    },
  ];
  const summary = computePortfolioSummary(investments);
  assert.equal(summary.totalValueCents, 1000000);
  assert.equal(summary.totalCostCents, 800000);
  assert.equal(summary.totalGainCents, 200000);
  assert.equal(summary.totalGainPercent, 25);

  const series = buildCombinedPortfolioSeries(investments, 180);
  assert.equal(series.length, 3);
  assert.equal(series[0].valueCents, 900000);
  assert.equal(series[2].valueCents, 1000000);
});

test('exportDocumentsToCsv handles nullable amounts and parent contract column', () => {
  const cats = new Map<string, CategoryRecord>([
    ['cat-certificates', { id: 'cat-certificates', name: 'Zeugnisse & Urkunden', slug: 'zeugnisse', accent: '#8C8C8C', sort_order: 3 }],
  ]);
  const csv = exportDocumentsToCsv([sampleDocs[3]], cats);
  assert.ok(csv.includes('"Zeugnis";"AZ-2024-09"'));
  assert.ok(!csv.includes('"Kategorie"'));
});

test('searchOverviewDocuments returns empty when query is empty or whitespace, and matches when non-empty', () => {
  assert.deepEqual(searchOverviewDocuments(sampleDocs, ''), []);
  assert.deepEqual(searchOverviewDocuments(sampleDocs, '   '), []);

  const scalable = searchOverviewDocuments(sampleDocs, 'Scalable');
  assert.equal(scalable.length, 2);
  assert.equal(scalable[0].id, 'doc-3'); // newer doc_date 2026-11-01 first
  assert.equal(scalable[1].id, 'doc-2');
});

