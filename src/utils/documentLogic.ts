import type {
  CategoryRecord,
  DocumentFilterState,
  DocumentInput,
  DocumentRecord,
  DocumentStats,
  InvestmentRecord,
  PortfolioSummary,
  PreviewSummaryData,
  SearchMatchItem,
  SortDirection,
  SortField,
} from '../types';

export function formatCurrencyCents(cents: number | null | undefined, currency = 'EUR'): string {
  if (cents === null || cents === undefined) return '—';
  const value = cents / 100;
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency || 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatGermanDate(isoDate: string): string {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

export function parseEuroInputToCents(raw: string | number): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.round(raw * 100) : 0;
  }
  const trimmed = raw.trim().replace(/[€\s]/g, '');
  if (!trimmed) return 0;
  let normalized = trimmed;
  if (trimmed.includes(',') && trimmed.includes('.')) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (trimmed.includes(',')) {
    normalized = trimmed.replace(',', '.');
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

export function parseOptionalEuroInputToCents(raw: string): number | null {
  if (!raw.trim()) return null;
  const cents = parseEuroInputToCents(raw);
  return cents;
}

function normalizeSearchToken(value: string): string {
  return value.toLocaleLowerCase('de-DE').trim();
}

export function matchesDocumentQuery(doc: DocumentRecord, rawQuery: string): boolean {
  const q = normalizeSearchToken(rawQuery);
  if (!q) return true;

  const terms = q.split(/\s+/).filter(Boolean);
  const haystackParts = [
    doc.title,
    doc.vendor,
    doc.doc_number,
    doc.doc_type,
    doc.category_name ?? '',
    doc.parent_title ?? '',
    doc.summary,
    doc.ai_summary,
    doc.extracted_text,
    doc.doc_date,
    formatGermanDate(doc.doc_date),
    doc.amount_cents !== null ? formatCurrencyCents(doc.amount_cents, doc.currency) : '',
    doc.amount_cents !== null ? (doc.amount_cents / 100).toFixed(2).replace('.', ',') : '',
    ...doc.tags,
    ...doc.line_items.map((item) => item.description),
  ];

  const haystack = haystackParts.join(' \n ').toLocaleLowerCase('de-DE');
  return terms.every((term) => haystack.includes(term));
}

export function filterDocuments(
  documents: DocumentRecord[],
  filter: DocumentFilterState,
): DocumentRecord[] {
  return documents.filter((doc) => {
    if (filter.docType !== 'Alle' && doc.doc_type !== filter.docType) {
      return false;
    }
    if (filter.categoryId !== 'Alle' && doc.category_id !== filter.categoryId) {
      return false;
    }
    if (filter.status !== 'Alle' && doc.status !== filter.status) {
      return false;
    }
    if (filter.dateFrom && doc.doc_date < filter.dateFrom) {
      return false;
    }
    if (filter.dateTo && doc.doc_date > filter.dateTo) {
      return false;
    }
    if (filter.query.trim() && !matchesDocumentQuery(doc, filter.query)) {
      return false;
    }
    return true;
  });
}

export function searchOverviewDocuments(
  documents: DocumentRecord[],
  rawQuery: string,
): DocumentRecord[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];
  const matched = filterDocuments(documents, {
    query: trimmed,
    docType: 'Alle',
    categoryId: 'Alle',
    status: 'Alle',
    dateFrom: '',
    dateTo: '',
  });
  return sortDocuments(matched, 'doc_date', 'desc');
}

export function sortDocuments(
  documents: DocumentRecord[],
  field: SortField,
  direction: SortDirection,
): DocumentRecord[] {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...documents].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case 'amount_cents':
        cmp = (a.amount_cents ?? -1) - (b.amount_cents ?? -1);
        break;
      case 'vendor':
        cmp = a.vendor.localeCompare(b.vendor, 'de');
        break;
      case 'title':
        cmp = a.title.localeCompare(b.title, 'de');
        break;
      case 'created_at':
        cmp = a.created_at.localeCompare(b.created_at);
        break;
      case 'doc_date':
      default:
        cmp = a.doc_date.localeCompare(b.doc_date);
        break;
    }
    if (cmp === 0) {
      return b.created_at.localeCompare(a.created_at);
    }
    return cmp * multiplier;
  });
}

export function computeDocumentStats(documents: DocumentRecord[]): DocumentStats {
  let contractCount = 0;
  let monthlyCount = 0;
  let certificateCount = 0;
  let openCount = 0;

  for (const doc of documents) {
    if (doc.doc_type === 'Vertrag') contractCount += 1;
    if (doc.doc_type === 'Monatsbeleg') monthlyCount += 1;
    if (doc.doc_type === 'Zeugnis') certificateCount += 1;
    if (doc.status === 'Offen' || doc.status === 'Prüfung') {
      openCount += 1;
    }
  }

  return {
    totalCount: documents.length,
    contractCount,
    monthlyCount,
    certificateCount,
    openCount,
  };
}

function createExcerpt(text: string, term: string, radius = 65): string {
  const lowerText = text.toLocaleLowerCase('de-DE');
  const idx = lowerText.indexOf(term.toLocaleLowerCase('de-DE'));
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

export function extractSearchMatches(doc: DocumentRecord, rawQuery: string): SearchMatchItem[] {
  const q = rawQuery.trim();
  if (!q) return [];
  const terms = q
    .toLocaleLowerCase('de-DE')
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return [];

  const candidates: Array<{ label: string; text: string }> = [
    { label: 'Anbieter / Aussteller', text: doc.vendor },
    { label: 'Titel', text: doc.title },
    { label: 'Akten- / Belegnr.', text: doc.doc_number },
    { label: 'Zugehöriger Vertrag', text: doc.parent_title || '' },
    { label: 'Zusammenfassung', text: doc.ai_summary || doc.summary },
    {
      label: 'Positionen',
      text: doc.line_items
        .map((item) => `${item.description} (${formatCurrencyCents(item.totalCents, doc.currency)})`)
        .join(' · '),
    },
    { label: 'Volltext / Inhalt', text: doc.extracted_text },
    { label: 'Schlagwörter', text: doc.tags.join(', ') },
  ];

  const matches: SearchMatchItem[] = [];
  for (const candidate of candidates) {
    if (!candidate.text) continue;
    const lower = candidate.text.toLocaleLowerCase('de-DE');
    const matchedTerm = terms.find((term) => lower.includes(term));
    if (matchedTerm) {
      matches.push({
        fieldLabel: candidate.label,
        snippet: createExcerpt(candidate.text, matchedTerm),
      });
    }
  }
  return matches.slice(0, 4);
}

export function buildPreviewSummary(doc: DocumentRecord, searchQuery = ''): PreviewSummaryData {
  const fallbackSummary =
    doc.amount_cents !== null
      ? `${doc.doc_type} von ${doc.vendor} vom ${formatGermanDate(doc.doc_date)} (${formatCurrencyCents(doc.amount_cents, doc.currency)}).`
      : `${doc.doc_type} (${doc.vendor}) vom ${formatGermanDate(doc.doc_date)}.`;

  const headline = doc.ai_summary?.trim() || doc.summary?.trim() || fallbackSummary;

  return {
    headline,
    matchedExcerpts: extractSearchMatches(doc, searchQuery),
  };
}

export function validateDocumentInput(input: Partial<DocumentInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.title || !input.title.trim()) {
    errors.title = 'Bitte geben Sie einen Dokumenttitel an.';
  }
  if (!input.vendor || !input.vendor.trim()) {
    errors.vendor = 'Bitte geben Sie Aussteller, Shop oder Institution an.';
  }
  if (!input.doc_date || !/^\d{4}-\d{2}-\d{2}$/.test(input.doc_date)) {
    errors.doc_date = 'Bitte wählen Sie ein gültiges Datum (JJJJ-MM-TT).';
  }
  if (
    input.amount_cents !== null &&
    input.amount_cents !== undefined &&
    (typeof input.amount_cents !== 'number' || Number.isNaN(input.amount_cents) || input.amount_cents < 0)
  ) {
    errors.amount_cents = 'Bitte geben Sie einen gültigen Betrag an.';
  }
  return errors;
}

export function computePortfolioSummary(investments: InvestmentRecord[]): PortfolioSummary {
  let totalValueCents = 0;
  let totalCostCents = 0;
  let monthlySavingsTotalCents = 0;

  for (const inv of investments) {
    totalValueCents += Math.round(inv.shares * inv.current_price_cents);
    totalCostCents += Math.round(inv.shares * inv.avg_buy_price_cents);
    monthlySavingsTotalCents += inv.monthly_savings_cents || 0;
  }

  const totalGainCents = totalValueCents - totalCostCents;
  const totalGainPercent = totalCostCents > 0 ? (totalGainCents / totalCostCents) * 100 : 0;

  return {
    totalValueCents,
    totalCostCents,
    totalGainCents,
    totalGainPercent,
    monthlySavingsTotalCents,
  };
}

export function buildCombinedPortfolioSeries(
  investments: InvestmentRecord[],
  rangeDays: number,
): Array<{ date: string; valueCents: number; costCents: number }> {
  if (investments.length === 0) return [];

  // Collect all unique sorted dates across histories
  const dateSet = new Set<string>();
  for (const inv of investments) {
    for (const pt of inv.history) {
      dateSet.add(pt.date);
    }
  }
  const allDates = Array.from(dateSet).sort();
  if (allDates.length === 0) return [];

  const latestDate = allDates[allDates.length - 1];
  const cutoffDateObj = new Date(`${latestDate}T00:00:00Z`);
  cutoffDateObj.setUTCDate(cutoffDateObj.getUTCDate() - rangeDays);
  const cutoffIso = cutoffDateObj.toISOString().slice(0, 10);

  const filteredDates = allDates.filter((d) => d >= cutoffIso);
  const activeDates = filteredDates.length >= 2 ? filteredDates : allDates;

  const totalCostCents = investments.reduce(
    (sum, inv) => sum + Math.round(inv.shares * inv.avg_buy_price_cents),
    0,
  );

  return activeDates.map((date) => {
    let valueCents = 0;
    for (const inv of investments) {
      let priceCents = inv.current_price_cents;
      for (const pt of inv.history) {
        if (pt.date <= date) {
          priceCents = pt.priceCents;
        } else {
          break;
        }
      }
      valueCents += Math.round(inv.shares * priceCents);
    }
    return { date, valueCents, costCents: totalCostCents };
  });
}

export function exportDocumentsToCsv(
  documents: DocumentRecord[],
  _categoriesById?: Map<string, CategoryRecord>,
): string {
  const escapeCell = (val: string) => `"${val.replace(/"/g, '""')}"`;
  const headers = [
    'Datum',
    'Typ',
    'Nummer',
    'Titel',
    'Aussteller',
    'Vertrag',
    'Status',
    'Preis',
    'Währung',
    'Zusammenfassung',
  ];

  const rows = documents.map((doc) => {
    const amount =
      doc.amount_cents !== null ? (doc.amount_cents / 100).toFixed(2).replace('.', ',') : '';
    return [
      formatGermanDate(doc.doc_date),
      doc.doc_type,
      doc.doc_number,
      doc.title,
      doc.vendor,
      doc.parent_title || '',
      doc.status,
      amount,
      doc.currency,
      doc.ai_summary || doc.summary,
    ]
      .map((cell) => escapeCell(String(cell ?? '')))
      .join(';');
  });

  return '\uFEFF' + [headers.map(escapeCell).join(';'), ...rows].join('\r\n');
}
