import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive as ArchiveIcon,
  ArrowDownUp,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  FolderGit2,
  Menu,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react';
import type {
  DocumentFilterState,
  DocumentInput,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
  InvestmentInput,
  InvestmentRecord,
  SortDirection,
  SortField,
} from './types';
import {
  exportDocumentsToCsv,
  extractSearchMatches,
  filterDocuments,
  formatCurrencyCents,
  formatGermanDate,
  searchOverviewDocuments,
  sortDocuments,
} from './utils/documentLogic';
import { DocumentDetailModal } from './components/DocumentDetailModal';
import { DocumentModal } from './components/DocumentModal';
import { DocumentPreviewPane } from './components/DocumentPreviewPane';
import { DonkeyHeadIcon } from './components/DonkeyHeadIcon';
import { HighlightText } from './components/HighlightText';
import { InvestmentsView } from './components/InvestmentsView';

type SidebarSection = 'overview' | 'all' | DocumentType | 'etf';

const INITIAL_FILTER: DocumentFilterState = {
  query: '',
  docType: 'Alle',
  categoryId: 'Alle',
  status: 'Alle',
  dateFrom: '',
  dateTo: '',
};

const DOC_TYPE_ITEMS: Array<{ id: SidebarSection; label: string; docType?: DocumentType }> = [
  { id: 'all', label: 'Alle Dokumente' },
  { id: 'Kaufbeleg', label: 'Kaufbelege', docType: 'Kaufbeleg' },
  { id: 'Vertrag', label: 'Verträge', docType: 'Vertrag' },
  { id: 'Monatsbeleg', label: 'Monatsbelege', docType: 'Monatsbeleg' },
  { id: 'Zeugnis', label: 'Zeugnisse', docType: 'Zeugnis' },
  { id: 'Sonstiges', label: 'Sonstiges', docType: 'Sonstiges' },
];

export default function App() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [investments, setInvestments] = useState<InvestmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Start in 'overview' where ONLY the add/drop area + search input are shown until a sidebar tab is clicked
  const [activeSection, setActiveSection] = useState<SidebarSection>('overview');
  const [overviewQuery, setOverviewQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [filter, setFilter] = useState<DocumentFilterState>(INITIAL_FILTER);
  const [sortField, setSortField] = useState<SortField>('doc_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const [docModalOpen, setDocModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocumentRecord | null>(null);
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);

  const [quickDragging, setQuickDragging] = useState(false);
  const [quickImporting, setQuickImporting] = useState(false);
  const [quickNotice, setQuickNotice] = useState<{
    type: 'error' | 'info';
    text: string;
    docId?: string;
  } | null>(null);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [docsRes, invRes] = await Promise.all([
        fetch('/api/documents'),
        fetch('/api/investments'),
      ]);
      if (!docsRes.ok || !invRes.ok) {
        throw new Error('Archivdaten konnten nicht geladen werden.');
      }
      const docsJson = (await docsRes.json()) as { documents: DocumentRecord[] };
      const invJson = (await invRes.json()) as { investments: InvestmentRecord[] };
      setDocuments(docsJson.documents || []);
      setInvestments(invJson.investments || []);
      setSelectedId((prev) => {
        if (prev && docsJson.documents.some((d) => d.id === prev)) return prev;
        return docsJson.documents[0]?.id ?? null;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Verbindungsfehler zum Server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const contracts = useMemo(
    () => documents.filter((d) => d.doc_type === 'Vertrag'),
    [documents],
  );

  const countByType = useMemo(() => {
    const map = new Map<DocumentType, number>();
    for (const d of documents) {
      map.set(d.doc_type, (map.get(d.doc_type) ?? 0) + 1);
    }
    return map;
  }, [documents]);

  const childCountByContractId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of documents) {
      if (doc.parent_id) {
        counts.set(doc.parent_id, (counts.get(doc.parent_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [documents]);

  const effectiveFilter = useMemo<DocumentFilterState>(() => {
    const typeScope: DocumentType | 'Alle' =
      activeSection === 'Kaufbeleg' ||
      activeSection === 'Vertrag' ||
      activeSection === 'Monatsbeleg' ||
      activeSection === 'Zeugnis' ||
      activeSection === 'Sonstiges'
        ? activeSection
        : 'Alle';
    return {
      ...filter,
      docType: typeScope,
      categoryId: 'Alle',
    };
  }, [filter, activeSection]);

  const filteredAndSortedDocs = useMemo(() => {
    const filtered = filterDocuments(documents, effectiveFilter);
    return sortDocuments(filtered, sortField, sortDirection);
  }, [documents, effectiveFilter, sortField, sortDirection]);

  const activeSelectedDoc = useMemo(() => {
    if (filteredAndSortedDocs.length === 0) return null;
    const found = filteredAndSortedDocs.find((d) => d.id === selectedId);
    return found || filteredAndSortedDocs[0];
  }, [filteredAndSortedDocs, selectedId]);

  const activeDetailDoc = useMemo(() => {
    if (!detailDocId) return null;
    return documents.find((d) => d.id === detailDocId) || null;
  }, [documents, detailDocId]);

  const hasOverviewQuery = overviewQuery.trim().length > 0;
  const overviewSearchResults = useMemo(
    () => searchOverviewDocuments(documents, overviewQuery),
    [documents, overviewQuery],
  );

  const hasActiveFilters =
    filter.query.trim() !== '' ||
    filter.status !== 'Alle' ||
    filter.dateFrom !== '' ||
    filter.dateTo !== '';

  const handleResetFilters = () => {
    setFilter(INITIAL_FILTER);
  };

  const handleSectionSelect = (section: SidebarSection) => {
    setActiveSection(section);
    setMobileMenuOpen(false);
  };

  const handleAutoImport = async (
    file: File | null,
    rawText: string,
    parentId?: string | null,
  ) => {
    const formData = new FormData();
    if (file) formData.append('file', file);
    if (rawText.trim()) formData.append('rawText', rawText.trim());
    if (parentId) formData.append('parent_id', parentId);

    const res = await fetch('/api/documents/auto-import', {
      method: 'POST',
      body: formData,
    });
    const json = (await res.json()) as {
      document?: DocumentRecord;
      extractionSource?: 'ai' | 'local';
      error?: string;
    };
    if (!res.ok || !json.document) {
      throw new Error(json.error || 'Dokument konnte nicht automatisch archiviert werden.');
    }

    await fetchAllData();
    setSelectedId(json.document.id);
    if (activeSection !== 'overview') {
      setDetailDocId(json.document.id);
    }
    setQuickNotice({
      type: 'info',
      text: `„${json.document.title}“ (${json.document.doc_type}) automatisch ausgelesen und archiviert.`,
      docId: json.document.id,
    });
  };

  const handleQuickDropFiles = async (file: File) => {
    setQuickImporting(true);
    setQuickNotice(null);
    try {
      await handleAutoImport(file, '', null);
    } catch (err) {
      setQuickNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Automatisches Auslesen fehlgeschlagen.',
      });
    } finally {
      setQuickImporting(false);
    }
  };

  const handleSaveEdit = async (payload: DocumentInput, editingId: string) => {
    const res = await fetch(`/api/documents/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { document?: DocumentRecord; error?: string };
    if (!res.ok || !json.document) {
      throw new Error(json.error || 'Dokument konnte nicht aktualisiert werden.');
    }
    await fetchAllData();
    setSelectedId(json.document.id);
    setDetailDocId(json.document.id);
  };

  const handleStatusChange = async (id: string, status: DocumentStatus) => {
    const res = await fetch(`/api/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const json = (await res.json()) as { document?: DocumentRecord; error?: string };
    if (!res.ok || !json.document) {
      throw new Error(json.error || 'Status konnte nicht geändert werden.');
    }
    setDocuments((prev) => prev.map((d) => (d.id === id ? json.document! : d)));
  };

  const handleDeleteDocument = async (id: string) => {
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      throw new Error(json.error || 'Löschen fehlgeschlagen.');
    }
    setDetailDocId((prev) => (prev === id ? null : prev));
    await fetchAllData();
  };

  const handleAiSummarize = async (id: string, query: string) => {
    const res = await fetch(`/api/documents/${id}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const json = (await res.json()) as { summary?: string; querySpecific?: boolean; error?: string };
    if (!res.ok || !json.summary) {
      throw new Error(json.error || 'Zusammenfassung konnte nicht erstellt werden.');
    }
    if (!json.querySpecific) {
      setDocuments((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ai_summary: json.summary! } : d)),
      );
    }
    return { summary: json.summary, querySpecific: Boolean(json.querySpecific) };
  };

  const handleRefreshMarket = async () => {
    const res = await fetch('/api/investments/refresh', { method: 'POST' });
    const json = (await res.json()) as {
      investments?: InvestmentRecord[];
      warnings?: string[];
      error?: string;
    };
    if (json.investments) {
      setInvestments(json.investments);
    }
    if (!res.ok) {
      throw new Error(json.error || 'Live-Kurse konnten nicht abgerufen werden.');
    }
    return { warnings: json.warnings };
  };

  const handleCreateInvestment = async (payload: InvestmentInput) => {
    const res = await fetch('/api/investments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { investment?: InvestmentRecord; error?: string };
    if (!res.ok || !json.investment) {
      throw new Error(json.error || 'Position konnte nicht angelegt werden.');
    }
    await fetchAllData();
  };

  const handleUpdateInvestment = async (id: string, patch: Partial<InvestmentInput>) => {
    const res = await fetch(`/api/investments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { investment?: InvestmentRecord; error?: string };
    if (!res.ok || !json.investment) {
      throw new Error(json.error || 'Position konnte nicht aktualisiert werden.');
    }
    await fetchAllData();
  };

  const handleDeleteInvestment = async (id: string) => {
    const res = await fetch(`/api/investments/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      throw new Error(json.error || 'Löschen fehlgeschlagen.');
    }
    await fetchAllData();
  };

  const handleExportCsv = () => {
    const csv = exportDocumentsToCsv(filteredAndSortedDocs);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `archive-export-${new Date().toISOString().slice(0, 10)}.csv`;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSelectAndOpenRow = (doc: DocumentRecord) => {
    setSelectedId(doc.id);
    setDetailDocId(doc.id);
  };

  const isDocumentListView =
    activeSection !== 'overview' && activeSection !== 'etf';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      {/* Top Bar: Eselkopf + Archive left, Mobile sidebar button + Dokument einfügen CTA right */}
      <header className="sticky top-0 z-30 bg-neutral-950/95 backdrop-blur-sm border-b border-neutral-800 px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Seitenleiste öffnen"
            className="lg:hidden p-2 text-neutral-300 hover:text-yellow-400 bg-neutral-900 border border-neutral-800 rounded-lg"
          >
            <Menu className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => handleSectionSelect('overview')}
            className="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight text-neutral-50 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-yellow-400"
          >
            <DonkeyHeadIcon className="w-7 h-7 text-yellow-400" />
            <span>Archive</span>
          </button>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              setEditingDoc(null);
              setDefaultParentId(null);
              setDocModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-neutral-950 bg-yellow-400 hover:bg-yellow-300 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-400"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Dokument einfügen</span>
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <div
        className={`flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 grid grid-cols-1 gap-5 items-start ${
          isDocumentListView
            ? 'lg:grid-cols-[224px_minmax(0,1fr)] xl:grid-cols-[224px_minmax(0,1fr)_310px]'
            : 'lg:grid-cols-[224px_minmax(0,1fr)]'
        }`}
      >
        {/* Left Sidebar Tabs */}
        <aside
          aria-label="Bereiche und Dokumenttypen"
          className={`${
            mobileMenuOpen ? 'block' : 'hidden'
          } lg:block bg-neutral-900 border border-neutral-800 rounded-xl p-3 space-y-5 lg:sticky lg:top-21`}
        >
          {/* Overview Tab */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => handleSectionSelect('overview')}
              className={`w-full px-3 py-2 rounded-lg text-left text-sm flex items-center justify-between gap-2 border transition-colors ${
                activeSection === 'overview'
                  ? 'bg-neutral-800 text-yellow-400 border-yellow-400/40 font-semibold'
                  : 'border-transparent text-neutral-300 hover:bg-neutral-800/60'
              }`}
            >
              <span>Übersicht</span>
              <Upload className="w-3.5 h-3.5 opacity-75" aria-hidden="true" />
            </button>
          </div>

          {/* Document Type Tabs (Categories completely removed) */}
          <div className="pt-3 border-t border-neutral-800 space-y-1">
            <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Dokumenttypen
            </h2>
            {DOC_TYPE_ITEMS.map((item) => {
              const active = activeSection === item.id;
              const count = item.docType
                ? (countByType.get(item.docType) ?? 0)
                : documents.length;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSectionSelect(item.id)}
                  className={`w-full px-3 py-2 rounded-lg text-left text-sm flex items-center justify-between gap-2 border transition-colors ${
                    active
                      ? 'bg-neutral-800 text-yellow-400 border-yellow-400/40 font-semibold'
                      : 'border-transparent text-neutral-300 hover:bg-neutral-800/60'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  <span
                    className={`text-xs font-mono tabular-nums ${
                      active ? 'text-yellow-400' : 'text-neutral-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Dedicated ETF Tab on the Left Sidebar */}
          <div className="pt-3 border-t border-neutral-800 space-y-1">
            <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Depot &amp; Anlagen
            </h2>
            <button
              type="button"
              onClick={() => handleSectionSelect('etf')}
              className={`w-full px-3 py-2 rounded-lg text-left text-sm flex items-center justify-between gap-2 border transition-colors ${
                activeSection === 'etf'
                  ? 'bg-neutral-800 text-yellow-400 border-yellow-400/40 font-semibold'
                  : 'border-transparent text-neutral-300 hover:bg-neutral-800/60'
              }`}
            >
              <span className="inline-flex items-center gap-2 truncate">
                <TrendingUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>ETF-Entwicklung</span>
              </span>
              <span
                className={`text-xs font-mono tabular-nums ${
                  activeSection === 'etf' ? 'text-yellow-400' : 'text-neutral-500'
                }`}
              >
                {investments.length}
              </span>
            </button>
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="min-w-0 space-y-4">
          {/* OVERVIEW VIEW: Show ONLY Hinzufügen / Auto-Dropzone (nothing else until left tabs are clicked!) */}
          {activeSection === 'overview' && (
            <section
              aria-label="Dokument hinzufügen"
              className="max-w-2xl mx-auto py-8 sm:py-14 space-y-4"
            >
              <label
                htmlFor="overview-auto-import-input"
                onDragOver={(e) => {
                  e.preventDefault();
                  setQuickDragging(true);
                }}
                onDragLeave={() => setQuickDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setQuickDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleQuickDropFiles(file);
                }}
                className={`block border-2 border-dashed rounded-2xl p-10 sm:p-12 text-center cursor-pointer transition-colors ${
                  quickDragging
                    ? 'border-yellow-400 bg-neutral-900'
                    : 'border-neutral-800 bg-neutral-900/70 hover:border-yellow-400/60'
                }`}
              >
                <div className="w-14 h-14 rounded-xl bg-neutral-950 border border-neutral-800 text-yellow-400 flex items-center justify-center mx-auto mb-4">
                  {quickImporting ? (
                    <RefreshCw className="w-6 h-6 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload className="w-6 h-6" aria-hidden="true" />
                  )}
                </div>

                <h1 className="text-lg font-semibold text-neutral-50">
                  {quickImporting
                    ? 'Dokument wird automatisch ausgelesen…'
                    : 'Dokument hinzufügen'}
                </h1>
                <p className="mt-2 text-xs text-neutral-400 max-w-md mx-auto leading-relaxed">
                  Datei hier ablegen oder auswählen. Kaufbelege, Verträge, Monatsbelege oder Zeugnisse werden automatisch ausgelesen und archiviert.
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <span className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-neutral-950 bg-yellow-400 hover:bg-yellow-300 rounded-lg">
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Datei auswählen</span>
                  </span>
                </div>

                <input
                  id="overview-auto-import-input"
                  type="file"
                  disabled={quickImporting}
                  accept="image/*,application/pdf,text/plain,text/csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void handleQuickDropFiles(file);
                  }}
                  className="sr-only"
                />
              </label>

              {quickNotice && (
                <div
                  role={quickNotice.type === 'error' ? 'alert' : 'status'}
                  className={`px-4 py-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                    quickNotice.type === 'error'
                      ? 'bg-red-950/50 border-red-900 text-red-200'
                      : 'bg-neutral-900 border-yellow-400/40 text-neutral-100'
                  }`}
                >
                  <span>{quickNotice.text}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {quickNotice.docId && (
                      <button
                        type="button"
                        onClick={() => setDetailDocId(quickNotice.docId!)}
                        className="px-2.5 py-1 text-xs font-semibold text-neutral-950 bg-yellow-400 hover:bg-yellow-300 rounded-md"
                      >
                        Im Fenster öffnen
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setQuickNotice(null)}
                      aria-label="Hinweis schließen"
                      className="p-1 text-neutral-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Overview Search: shows ONLY the input when empty, and lists found documents centered below when non-empty */}
              <div className="space-y-3">
                <div className="relative">
                  <Search
                    className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="overview-search-input"
                    type="text"
                    role="searchbox"
                    aria-label="Dokumente auf der Übersicht suchen"
                    value={overviewQuery}
                    onChange={(e) => setOverviewQuery(e.target.value)}
                    placeholder="Dokument suchen (Titel, Anbieter, Nummer, Inhalt)…"
                    className="w-full pl-10 pr-10 py-3 text-sm bg-neutral-900 text-neutral-100 border border-neutral-800 rounded-xl placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400/60 transition-colors"
                  />
                  {overviewQuery && (
                    <button
                      type="button"
                      onClick={() => setOverviewQuery('')}
                      aria-label="Übersichtssuche leeren"
                      className="p-1.5 text-neutral-400 hover:text-neutral-100 absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {hasOverviewQuery && (
                  <div
                    data-testid="overview-search-results"
                    className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden"
                  >
                    {overviewSearchResults.length === 0 ? (
                      <p className="px-4 py-4 text-xs text-neutral-400 text-center">
                        Keine passenden Dokumente für „{overviewQuery.trim()}“ gefunden.
                      </p>
                    ) : (
                      <>
                        <div className="px-4 py-2 border-b border-neutral-800 bg-neutral-950/60 flex items-center justify-between text-xs font-medium text-neutral-400">
                          <span>Gefundene Dokumente ({overviewSearchResults.length})</span>
                        </div>
                        <ul className="divide-y divide-neutral-800/80">
                          {overviewSearchResults.map((doc) => {
                            const firstMatch = extractSearchMatches(doc, overviewQuery)[0];
                            return (
                              <li key={doc.id}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectAndOpenRow(doc)}
                                  className="w-full px-4 py-3 text-left flex items-start justify-between gap-4 hover:bg-neutral-800/50 transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-yellow-400"
                                >
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="text-sm font-semibold text-neutral-100 truncate">
                                      <HighlightText text={doc.title} query={overviewQuery} />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-neutral-400">
                                      <span className="font-medium text-neutral-300">
                                        <HighlightText text={doc.vendor} query={overviewQuery} />
                                      </span>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-yellow-400/90">{doc.doc_type}</span>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono tabular-nums">
                                        {formatGermanDate(doc.doc_date)}
                                      </span>
                                      {doc.doc_number && (
                                        <>
                                          <span aria-hidden="true">·</span>
                                          <span className="font-mono tabular-nums">
                                            Nr. <HighlightText text={doc.doc_number} query={overviewQuery} />
                                          </span>
                                        </>
                                      )}
                                    </div>
                                    {firstMatch && (
                                      <p className="text-xs text-neutral-400 line-clamp-1 pt-0.5">
                                        <span className="text-neutral-500">{firstMatch.fieldLabel}: </span>
                                        <HighlightText text={firstMatch.snippet} query={overviewQuery} />
                                      </p>
                                    )}
                                  </div>
                                  <span className="text-xs font-mono tabular-nums text-neutral-300 shrink-0 pt-0.5">
                                    {formatCurrencyCents(doc.amount_cents, doc.currency)}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* DEDICATED ETF SIDEBAR TAB */}
          {activeSection === 'etf' && (
            <InvestmentsView
              investments={investments}
              contracts={contracts}
              onOpenContract={(contractId) => {
                setSelectedId(contractId);
                setDetailDocId(contractId);
              }}
              onRefreshMarket={handleRefreshMarket}
              onCreateInvestment={handleCreateInvestment}
              onUpdateInvestment={handleUpdateInvestment}
              onDeleteInvestment={handleDeleteInvestment}
            />
          )}

          {/* DOCUMENT TYPE VIEWS (Opened when clicking sidebar document-type tabs) */}
          {isDocumentListView && (
            <>
              {/* Search, Status & Sort Toolbar */}
              <section
                aria-label="Suche und Sortierung"
                className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3"
              >
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="relative flex-1 min-w-0">
                    <Search
                      className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      role="searchbox"
                      aria-label="Archiv durchsuchen"
                      value={filter.query}
                      onChange={(e) => setFilter((prev) => ({ ...prev, query: e.target.value }))}
                      placeholder="Anbieter, Titel, Vertrag, Zeugnis oder Inhalt suchen…"
                      className="w-full pl-9 pr-9 py-2 text-sm bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                    {filter.query && (
                      <button
                        type="button"
                        onClick={() => setFilter((prev) => ({ ...prev, query: '' }))}
                        aria-label="Suchfeld leeren"
                        className="p-1 text-neutral-400 hover:text-neutral-100 absolute right-2 top-1/2 -translate-y-1/2"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <label htmlFor="status-filter-select" className="sr-only">
                      Status filtern
                    </label>
                    <select
                      id="status-filter-select"
                      value={filter.status}
                      onChange={(e) =>
                        setFilter((prev) => ({
                          ...prev,
                          status: e.target.value as DocumentStatus | 'Alle',
                        }))
                      }
                      className="px-3 py-2 text-xs font-medium text-neutral-200 bg-neutral-950 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    >
                      <option value="Alle">Alle Status</option>
                      <option value="Archiviert">Archiviert</option>
                      <option value="Aktiv">Aktiv</option>
                      <option value="Offen">Offen</option>
                      <option value="Prüfung">Prüfung</option>
                    </select>

                    <label htmlFor="sort-field-select" className="sr-only">
                      Sortieren nach
                    </label>
                    <select
                      id="sort-field-select"
                      value={sortField}
                      onChange={(e) => setSortField(e.target.value as SortField)}
                      className="min-w-[150px] px-3 py-2 text-xs font-medium text-neutral-200 bg-neutral-950 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    >
                      <option value="doc_date">Sortierung: Datum</option>
                      <option value="vendor">Sortierung: Aussteller</option>
                      <option value="title">Sortierung: Titel</option>
                      <option value="amount_cents">Sortierung: Vermerk</option>
                      <option value="created_at">Sortierung: Erfassungszeit</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'))}
                      aria-label={
                        sortDirection === 'desc'
                          ? 'Sortierrichtung: Absteigend'
                          : 'Sortierrichtung: Aufsteigend'
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-200 bg-neutral-950 border border-neutral-700 rounded-lg hover:border-yellow-400/60 whitespace-nowrap shrink-0"
                    >
                      <ArrowDownUp className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
                      <span>{sortDirection === 'desc' ? 'Absteigend' : 'Aufsteigend'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                    <label htmlFor="date-from-input">Zeitraum:</label>
                    <input
                      id="date-from-input"
                      type="date"
                      aria-label="Datum von"
                      value={filter.dateFrom}
                      onChange={(e) => setFilter((prev) => ({ ...prev, dateFrom: e.target.value }))}
                      className="px-2 py-1 font-mono text-xs bg-neutral-950 text-neutral-200 border border-neutral-700 rounded-md"
                    />
                    <span aria-hidden="true">–</span>
                    <input
                      id="date-to-input"
                      type="date"
                      aria-label="Datum bis"
                      value={filter.dateTo}
                      onChange={(e) => setFilter((prev) => ({ ...prev, dateTo: e.target.value }))}
                      className="px-2 py-1 font-mono text-xs bg-neutral-950 text-neutral-200 border border-neutral-700 rounded-md"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="inline-flex items-center gap-1 text-xs font-medium text-yellow-400 hover:underline"
                      >
                        <RotateCcw className="w-3 h-3" aria-hidden="true" />
                        <span>Filter zurücksetzen</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleExportCsv}
                      disabled={filteredAndSortedDocs.length === 0}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-300 hover:text-yellow-400 disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>CSV</span>
                    </button>
                  </div>
                </div>
              </section>

              {loadError && (
                <div
                  role="alert"
                  className="bg-red-950/50 border border-red-900 rounded-xl p-4 flex items-center justify-between gap-4"
                >
                  <span className="text-sm text-red-200">{loadError}</span>
                  <button
                    type="button"
                    onClick={fetchAllData}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-red-700 rounded-lg hover:bg-red-600"
                  >
                    Erneut laden
                  </button>
                </div>
              )}

              {/* Document List */}
              <section
                aria-label="Archivliste"
                className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden"
              >
                <div className="px-4 py-2.5 border-b border-neutral-800 bg-neutral-950/60 flex items-center justify-between gap-4 text-xs font-semibold text-neutral-400">
                  <span>Dokument / Aussteller ({filteredAndSortedDocs.length})</span>
                  <div className="flex items-center gap-6">
                    <span className="hidden sm:inline">Status</span>
                    <span className="w-20 text-right">Vermerk</span>
                  </div>
                </div>

                {loading ? (
                  <div className="divide-y divide-neutral-800">
                    {[1, 2, 3, 4].map((n) => (
                      <div key={n} className="px-4 py-3.5 flex items-center justify-between gap-4 animate-pulse">
                        <div className="space-y-2 flex-1">
                          <div className="h-4 bg-neutral-800 rounded w-1/2" />
                          <div className="h-3 bg-neutral-800/60 rounded w-1/3" />
                        </div>
                        <div className="h-4 bg-neutral-800 rounded w-16" />
                      </div>
                    ))}
                  </div>
                ) : filteredAndSortedDocs.length === 0 ? (
                  <div className="px-6 py-12 text-center space-y-3">
                    <div className="w-10 h-10 rounded-lg bg-neutral-800 text-yellow-400 flex items-center justify-center mx-auto">
                      <FileText className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-semibold text-neutral-100">
                      Keine Dokumente gefunden
                    </h3>
                    <p className="text-xs text-neutral-400 max-w-sm mx-auto leading-relaxed">
                      Passe Suchbegriff oder Filter an oder füge über den Button oben ein neues Dokument hinzu.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-neutral-800/80" data-testid="document-list">
                    {filteredAndSortedDocs.map((doc) => {
                      const isSelected = activeSelectedDoc?.id === doc.id;
                      const childCount = childCountByContractId.get(doc.id) ?? 0;

                      return (
                        <li key={doc.id}>
                          <button
                            type="button"
                            onClick={() => handleSelectAndOpenRow(doc)}
                            aria-current={isSelected ? 'true' : undefined}
                            className={`w-full px-4 py-3 text-left flex items-center justify-between gap-4 transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-yellow-400 ${
                              isSelected
                                ? 'bg-neutral-800/85 border-l-2 border-yellow-400'
                                : 'hover:bg-neutral-800/40'
                            }`}
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-baseline gap-2 min-w-0">
                                <span
                                  className={`text-sm font-semibold truncate ${
                                    isSelected ? 'text-yellow-300' : 'text-neutral-100'
                                  }`}
                                >
                                  <HighlightText text={doc.title} query={filter.query} />
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-neutral-400">
                                <span className="font-medium text-neutral-300">
                                  <HighlightText text={doc.vendor} query={filter.query} />
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="text-yellow-400/90">{doc.doc_type}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  {formatGermanDate(doc.doc_date)}
                                </span>
                                {doc.doc_number && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums">
                                      Nr. <HighlightText text={doc.doc_number} query={filter.query} />
                                    </span>
                                  </>
                                )}
                                {childCount > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="inline-flex items-center gap-1 text-neutral-300">
                                      <FolderGit2 className="w-3 h-3 text-yellow-400" aria-hidden="true" />
                                      {childCount} {childCount === 1 ? 'Monatsdatei' : 'Monatsdateien'}
                                    </span>
                                  </>
                                )}
                                {doc.parent_title && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-neutral-400 truncate max-w-[180px]">
                                      zu {doc.parent_title}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-5 shrink-0">
                              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium">
                                {doc.status === 'Archiviert' && (
                                  <>
                                    <ArchiveIcon className="w-3.5 h-3.5 text-neutral-400" aria-hidden="true" />
                                    <span className="text-neutral-300">Archiviert</span>
                                  </>
                                )}
                                {doc.status === 'Aktiv' && (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
                                    <span className="text-yellow-300">Aktiv</span>
                                  </>
                                )}
                                {doc.status === 'Offen' && (
                                  <>
                                    <Clock className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
                                    <span className="text-neutral-200">Offen</span>
                                  </>
                                )}
                                {doc.status === 'Prüfung' && (
                                  <>
                                    <AlertCircle className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
                                    <span className="text-neutral-200">Prüfung</span>
                                  </>
                                )}
                              </span>

                              <span className="w-20 text-right text-xs font-mono tabular-nums text-neutral-300">
                                {formatCurrencyCents(doc.amount_cents, doc.currency)}
                              </span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </main>

        {/* Slim Right Preview (only shown when viewing a document list) */}
        {isDocumentListView && (
          <div className="hidden xl:block sticky top-21">
            <DocumentPreviewPane
              document={activeSelectedDoc}
              allDocuments={documents}
              investments={investments}
              searchQuery={filter.query}
              onOpenWindow={(doc) => setDetailDocId(doc.id)}
              onAttachMonthlyFile={(contractId) => {
                setEditingDoc(null);
                setDefaultParentId(contractId);
                setDocModalOpen(true);
              }}
            />
          </div>
        )}
      </div>

      {/* Dedicated Window Modal when clicking any archive entry (includes live ETF chart on Depot contracts) */}
      <DocumentDetailModal
        document={activeDetailDoc}
        allDocuments={documents}
        investments={investments}
        searchQuery={activeSection === 'overview' ? overviewQuery : filter.query}
        onClose={() => setDetailDocId(null)}
        onSelectDocument={(id) => {
          setSelectedId(id);
          setDetailDocId(id);
        }}
        onAttachMonthlyFile={(contractId) => {
          setEditingDoc(null);
          setDefaultParentId(contractId);
          setDocModalOpen(true);
        }}
        onOpenInvestmentsTab={() => handleSectionSelect('etf')}
        onRefreshMarket={handleRefreshMarket}
        onStatusChange={handleStatusChange}
        onEdit={(doc) => {
          setDetailDocId(null);
          setEditingDoc(doc);
          setDefaultParentId(null);
          setDocModalOpen(true);
        }}
        onDelete={handleDeleteDocument}
        onAiSummarize={handleAiSummarize}
      />

      {/* Auto-Import / Edit Document Modal */}
      <DocumentModal
        isOpen={docModalOpen}
        editingDocument={editingDoc}
        defaultParentId={defaultParentId}
        contracts={contracts}
        onClose={() => setDocModalOpen(false)}
        onAutoImport={handleAutoImport}
        onSaveEdit={handleSaveEdit}
      />
    </div>
  );
}
