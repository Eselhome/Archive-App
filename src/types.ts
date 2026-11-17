export type DocumentType = 'Kaufbeleg' | 'Vertrag' | 'Monatsbeleg' | 'Zeugnis' | 'Sonstiges';

export type DocumentStatus = 'Archiviert' | 'Aktiv' | 'Offen' | 'Prüfung';

export type SortField = 'doc_date' | 'amount_cents' | 'vendor' | 'title' | 'created_at';

export type SortDirection = 'asc' | 'desc';

export interface LineItem {
  description: string;
  quantity?: string;
  unitPriceCents?: number;
  totalCents: number;
}

export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  accent: string;
  sort_order: number;
  document_count?: number;
}

export interface DocumentRecord {
  id: string;
  title: string;
  doc_type: DocumentType;
  vendor: string;
  doc_number: string;
  doc_date: string; // YYYY-MM-DD
  amount_cents: number | null;
  tax_cents: number | null;
  currency: string;
  category_id: string;
  category_name?: string;
  parent_id: string | null;
  parent_title?: string | null;
  status: DocumentStatus;
  summary: string;
  ai_summary: string;
  extracted_text: string;
  line_items: LineItem[];
  tags: string[];
  file_url: string | null;
  file_name: string | null;
  file_mime: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentInput {
  title: string;
  doc_type: DocumentType;
  vendor: string;
  doc_number: string;
  doc_date: string;
  amount_cents: number | null;
  tax_cents: number | null;
  currency: string;
  category_id: string;
  parent_id?: string | null;
  status: DocumentStatus;
  summary: string;
  ai_summary?: string;
  extracted_text: string;
  line_items: LineItem[];
  tags: string[];
}

export interface DocumentFilterState {
  query: string;
  docType: DocumentType | 'Alle';
  categoryId: string | 'Alle';
  status: DocumentStatus | 'Alle';
  dateFrom: string;
  dateTo: string;
}

export interface DocumentStats {
  totalCount: number;
  contractCount: number;
  monthlyCount: number;
  certificateCount: number;
  openCount: number;
}

export interface SearchMatchItem {
  fieldLabel: string;
  snippet: string;
}

export interface PreviewSummaryData {
  headline: string;
  matchedExcerpts: SearchMatchItem[];
}

export interface AiExtractionResult {
  title: string;
  doc_type: DocumentType;
  vendor: string;
  doc_number: string;
  doc_date: string;
  amount_eur: number | null;
  tax_eur: number | null;
  suggested_category_name: string;
  status: DocumentStatus;
  summary: string;
  extracted_text: string;
  line_items: LineItem[];
  tags: string[];
}

export interface PricePoint {
  date: string; // YYYY-MM-DD
  priceCents: number;
}

export interface InvestmentRecord {
  id: string;
  name: string;
  symbol: string; // Yahoo/Exchange ticker e.g. EUNL.DE, VWCE.DE
  isin: string;
  asset_type: 'ETF' | 'Aktie' | 'Fonds' | 'Anleihe';
  contract_id: string | null;
  contract_title?: string | null;
  shares: number;
  avg_buy_price_cents: number;
  current_price_cents: number;
  currency: string;
  monthly_savings_cents: number;
  last_updated: string;
  price_source: string;
  history: PricePoint[];
}

export interface InvestmentInput {
  name: string;
  symbol: string;
  isin: string;
  asset_type: 'ETF' | 'Aktie' | 'Fonds' | 'Anleihe';
  contract_id: string | null;
  shares: number;
  avg_buy_price_cents: number;
  current_price_cents: number;
  currency: string;
  monthly_savings_cents: number;
}

export interface PortfolioSummary {
  totalValueCents: number;
  totalCostCents: number;
  totalGainCents: number;
  totalGainPercent: number;
  monthlySavingsTotalCents: number;
}
