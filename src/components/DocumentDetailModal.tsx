import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Clock,
  ExternalLink,
  FilePlus2,
  FolderGit2,
  Maximize2,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import type { DocumentRecord, DocumentStatus, InvestmentRecord } from '../types';
import {
  buildPreviewSummary,
  computePortfolioSummary,
  formatCurrencyCents,
  formatGermanDate,
} from '../utils/documentLogic';
import { EtfChartWidget } from './EtfChartWidget';
import { HighlightText } from './HighlightText';

interface DocumentDetailModalProps {
  document: DocumentRecord | null;
  allDocuments: DocumentRecord[];
  investments: InvestmentRecord[];
  searchQuery: string;
  onClose: () => void;
  onSelectDocument: (id: string) => void;
  onAttachMonthlyFile: (contractId: string) => void;
  onOpenInvestmentsTab: () => void;
  onRefreshMarket: () => Promise<{ warnings?: string[] }>;
  onStatusChange: (id: string, status: DocumentStatus) => Promise<void>;
  onEdit: (doc: DocumentRecord) => void;
  onDelete: (id: string) => Promise<void>;
  onAiSummarize: (id: string, query: string) => Promise<{ summary: string; querySpecific: boolean }>;
}

export const DocumentDetailModal: React.FC<DocumentDetailModalProps> = ({
  document,
  allDocuments,
  investments,
  searchQuery,
  onClose,
  onSelectDocument,
  onAttachMonthlyFile,
  onOpenInvestmentsTab,
  onRefreshMarket,
  onStatusChange,
  onEdit,
  onDelete,
  onAiSummarize,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [querySummary, setQuerySummary] = useState<{ docId: string; query: string; text: string } | null>(null);
  const [imgError, setImgError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showFullText, setShowFullText] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
    setAiError(null);
    setImgError(false);
    setShowFullText(false);
    setLightboxOpen(false);
  }, [document?.id]);

  useEffect(() => {
    if (!document) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxOpen) {
          setLightboxOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [document, lightboxOpen, onClose]);

  if (!document) return null;

  const previewSummary = buildPreviewSummary(document, searchQuery);
  const activeQuerySummary =
    querySummary && querySummary.docId === document.id && querySummary.query === searchQuery.trim()
      ? querySummary.text
      : null;

  const childDocuments = allDocuments.filter((d) => d.parent_id === document.id);
  const linkedInvestments = investments.filter((inv) => inv.contract_id === document.id);
  const linkedPortfolio = linkedInvestments.length > 0 ? computePortfolioSummary(linkedInvestments) : null;

  const isImage =
    Boolean(document.file_url) &&
    (document.file_mime?.startsWith('image/') ||
      /\.(jpg|jpeg|png|webp|gif)$/i.test(document.file_url || ''));
  const isPdf =
    Boolean(document.file_url) &&
    (document.file_mime === 'application/pdf' || /\.pdf$/i.test(document.file_url || ''));

  const handleAiSummarize = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await onAiSummarize(document.id, searchQuery.trim());
      if (result.querySpecific) {
        setQuerySummary({ docId: document.id, query: searchQuery.trim(), text: result.summary });
      } else {
        setQuerySummary(null);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Zusammenfassung konnte nicht erstellt werden.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      await onDelete(document.id);
      setConfirmDelete(false);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusSelect = async (newStatus: DocumentStatus) => {
    if (newStatus === document.status) return;
    setUpdatingStatus(true);
    try {
      await onStatusChange(document.id, newStatus);
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-modal-title"
        className="fixed inset-0 z-40 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
        onClick={onClose}
      >
        <div
          className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-neutral-800 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400">
                <span className="font-semibold text-yellow-400">{document.doc_type}</span>
                {document.doc_number && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Nr. {document.doc_number}</span>
                  </>
                )}
              </div>
              <h2 id="detail-modal-title" className="mt-1 text-lg font-semibold text-neutral-50 leading-snug break-words">
                <HighlightText text={document.title} query={searchQuery} />
              </h2>
              <p className="mt-0.5 text-sm text-neutral-400">
                <HighlightText text={document.vendor} query={searchQuery} />
                {' · '}
                <span className="font-mono text-xs tabular-nums">
                  {formatGermanDate(document.doc_date)}
                </span>
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onEdit(document)}
                aria-label={`Dokument "${document.title}" bearbeiten`}
                className="p-2 text-neutral-400 hover:text-yellow-400 hover:bg-neutral-800 rounded-lg transition-colors"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete((v) => !v)}
                aria-label={`Dokument "${document.title}" löschen`}
                className="p-2 text-neutral-400 hover:text-red-400 hover:bg-neutral-800 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fenster schließen"
                className="p-2 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {confirmDelete && (
            <div className="px-5 py-3 bg-red-950/60 border-b border-red-900 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-red-200">
                Dieses Dokument dauerhaft aus dem Archiv löschen?
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2.5 py-1 text-xs font-medium text-neutral-200 bg-neutral-800 border border-neutral-700 rounded-md hover:bg-neutral-700"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDeleteConfirm}
                  className="px-2.5 py-1 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-600 disabled:opacity-50"
                >
                  {deleting ? 'Lösche…' : 'Bestätigen'}
                </button>
              </div>
            </div>
          )}

          {/* Body */}
          <div className="p-5 space-y-5 overflow-y-auto">
            {/* Compact Status & optional archived price (no cost calculations) */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-neutral-800">
              <div className="flex items-center gap-3">
                <label htmlFor="detail-status-select" className="text-xs text-neutral-400">
                  Status:
                </label>
                <div className="flex items-center gap-1.5">
                  {document.status === 'Archiviert' && (
                    <Archive className="w-3.5 h-3.5 text-neutral-400" aria-hidden="true" />
                  )}
                  {document.status === 'Aktiv' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
                  )}
                  {document.status === 'Offen' && (
                    <Clock className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
                  )}
                  {document.status === 'Prüfung' && (
                    <AlertCircle className="w-3.5 h-3.5 text-red-400" aria-hidden="true" />
                  )}
                  <select
                    id="detail-status-select"
                    disabled={updatingStatus}
                    value={document.status}
                    onChange={(e) => handleStatusSelect(e.target.value as DocumentStatus)}
                    className="text-xs font-medium text-neutral-100 bg-neutral-950 border border-neutral-700 rounded-md px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="Archiviert">Archiviert</option>
                    <option value="Aktiv">Aktiv</option>
                    <option value="Offen">Offen</option>
                    <option value="Prüfung">Prüfung</option>
                  </select>
                </div>
              </div>

              {document.amount_cents !== null && (
                <div className="text-xs text-neutral-400">
                  <span>Vermerk: </span>
                  <span className="font-mono tabular-nums text-sm font-semibold text-neutral-100">
                    {formatCurrencyCents(document.amount_cents, document.currency)}
                  </span>
                </div>
              )}
            </div>

            {/* Parent contract breadcrumb */}
            {document.parent_id && document.parent_title && (
              <div className="bg-neutral-950 border border-neutral-800 rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="block text-[11px] text-neutral-400">Gehört zu Vertrag</span>
                  <span className="block text-xs font-medium text-neutral-100 truncate">
                    {document.parent_title}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectDocument(document.parent_id!)}
                  className="text-xs font-medium text-yellow-400 hover:underline whitespace-nowrap shrink-0"
                >
                  Vertrag öffnen
                </button>
              </div>
            )}

            {/* Search Context Hits */}
            {searchQuery.trim() && previewSummary.matchedExcerpts.length > 0 && (
              <section
                aria-label="Suchtreffer im Dokument"
                className="bg-neutral-950 border border-yellow-400/30 rounded-lg p-3.5 space-y-2"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-yellow-400">
                  <Search className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Suchtreffer für „{searchQuery.trim()}“</span>
                </div>
                <ul className="space-y-1.5">
                  {previewSummary.matchedExcerpts.map((match, idx) => (
                    <li key={idx} className="text-xs text-neutral-300 leading-relaxed">
                      <span className="font-medium text-neutral-400">{match.fieldLabel}: </span>
                      <HighlightText text={match.snippet} query={searchQuery} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Content Summary */}
            <section aria-label="Inhaltszusammenfassung" className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-neutral-200 tracking-wide">
                  Inhaltszusammenfassung
                </h3>
                <button
                  type="button"
                  disabled={aiLoading}
                  onClick={handleAiSummarize}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-yellow-400 hover:text-yellow-300 disabled:opacity-50"
                >
                  {aiLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>
                    {aiLoading
                      ? 'Fasse zusammen…'
                      : searchQuery.trim()
                        ? 'Suchkontext per KI erklären'
                        : 'KI-Zusammenfassung'}
                  </span>
                </button>
              </div>

              <div className="bg-neutral-950/70 border border-neutral-800 rounded-lg p-3.5 space-y-2">
                <p className="text-sm text-neutral-200 leading-relaxed">
                  <HighlightText
                    text={activeQuerySummary || previewSummary.headline}
                    query={searchQuery}
                  />
                </p>
                {aiError && (
                  <p role="alert" className="text-xs text-red-300 bg-red-950/50 border border-red-900 rounded-md px-2.5 py-1.5">
                    {aiError}
                  </p>
                )}
                {document.tags.length > 0 && (
                  <div className="pt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
                    <span className="font-medium text-neutral-300">Schlagwörter:</span>
                    <span>
                      <HighlightText text={document.tags.join(' · ')} query={searchQuery} />
                    </span>
                  </div>
                )}
              </div>
            </section>

            {/* Live ETF Development Graph inside Depot / Investment Contracts */}
            {linkedPortfolio && (
              <section
                aria-label="Aktuelle Depot- & ETF-Entwicklung"
                className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-yellow-400" aria-hidden="true" />
                    <h3 className="text-xs font-semibold text-neutral-100 tracking-wide">
                      Aktuelle ETF-Entwicklung in diesem Depot ({linkedInvestments.length})
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenInvestmentsTab();
                    }}
                    className="text-xs font-medium text-yellow-400 hover:underline"
                  >
                    Alle ETFs verwalten
                  </button>
                </div>

                <EtfChartWidget
                  investments={linkedInvestments}
                  onRefreshMarket={onRefreshMarket}
                  compact
                />

                <div className="divide-y divide-neutral-800/80 border-t border-neutral-800 pt-1">
                  {linkedInvestments.map((inv) => {
                    const marketVal = Math.round(inv.shares * inv.current_price_cents);
                    return (
                      <div key={inv.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                        <span className="text-neutral-300 truncate">
                          {inv.name} <span className="text-neutral-500 font-mono">({inv.symbol})</span>
                        </span>
                        <span className="font-mono tabular-nums text-neutral-100 shrink-0">
                          {formatCurrencyCents(marketVal, inv.currency)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Linked Monthly Documents (for Contracts) */}
            {document.doc_type === 'Vertrag' && (
              <section aria-label="Verknüpfte Monatsbelege" className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-neutral-200 tracking-wide flex items-center gap-1.5">
                    <FolderGit2 className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
                    <span>Monatliche Dateien &amp; Anhänge ({childDocuments.length})</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onAttachMonthlyFile(document.id);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-yellow-400 hover:underline"
                  >
                    <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Monatsdatei einfügen</span>
                  </button>
                </div>
                {childDocuments.length > 0 ? (
                  <div className="border border-neutral-800 rounded-lg divide-y divide-neutral-800/80 bg-neutral-950/50">
                    {childDocuments.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => onSelectDocument(child.id)}
                        className="w-full px-3 py-2 text-left flex items-center justify-between gap-3 hover:bg-neutral-800/60 transition-colors"
                      >
                        <div className="min-w-0">
                          <span className="block text-xs font-medium text-neutral-200 truncate">
                            {child.title}
                          </span>
                          <span className="block text-[11px] font-mono tabular-nums text-neutral-400">
                            {formatGermanDate(child.doc_date)}
                            {child.doc_number ? ` · Nr. ${child.doc_number}` : ''}
                          </span>
                        </div>
                        <span className="text-xs font-mono tabular-nums text-neutral-300 shrink-0">
                          {formatCurrencyCents(child.amount_cents, child.currency)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-400 bg-neutral-950/40 border border-neutral-800 rounded-lg px-3 py-2.5">
                    Noch keine monatlichen Dokumente mit diesem Vertrag verknüpft.
                  </p>
                )}
              </section>
            )}

            {/* Original File Preview */}
            <section aria-label="Dateivorschau" className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-neutral-200 tracking-wide">
                  Originaldokument
                </h3>
                {document.file_url && (
                  <div className="flex items-center gap-3">
                    {isImage && !imgError && (
                      <button
                        type="button"
                        onClick={() => setLightboxOpen(true)}
                        className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-100"
                      >
                        <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Vollbild</span>
                      </button>
                    )}
                    <a
                      href={document.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-yellow-400 hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Datei öffnen</span>
                    </a>
                  </div>
                )}
              </div>

              {isImage && !imgError && document.file_url ? (
                <div className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-950">
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    aria-label={`Dokument "${document.title}" vergrößern`}
                    className="block w-full text-left"
                  >
                    <img
                      src={document.file_url}
                      alt={`Vorschau für ${document.title}`}
                      referrerPolicy="no-referrer"
                      onError={() => setImgError(true)}
                      className="w-full max-h-80 object-contain mx-auto bg-neutral-950"
                    />
                  </button>
                </div>
              ) : isPdf && document.file_url ? (
                <div className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-950 h-80">
                  <iframe
                    src={document.file_url}
                    title={`PDF-Vorschau: ${document.title}`}
                    className="w-full h-full border-0"
                  />
                </div>
              ) : (
                <div className="border border-neutral-800 rounded-lg bg-neutral-950/60 p-4 text-xs text-neutral-400">
                  {document.summary || 'Digital archiviertes Dokument ohne Bild-/PDF-Anhang.'}
                </div>
              )}
            </section>

            {/* Fulltext */}
            {document.extracted_text && (
              <section aria-label="Extrahierter Volltext" className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-neutral-200 tracking-wide">
                    Ausgelesener Volltext
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowFullText((v) => !v)}
                    className="text-xs text-yellow-400 hover:underline"
                  >
                    {showFullText ? 'Weniger anzeigen' : 'Volltext anzeigen'}
                  </button>
                </div>
                <div
                  className={`text-xs font-mono text-neutral-400 bg-neutral-950/70 border border-neutral-800 rounded-lg p-3 leading-relaxed ${
                    showFullText ? 'max-h-60 overflow-y-auto' : 'line-clamp-3'
                  }`}
                >
                  <HighlightText text={document.extracted_text} query={searchQuery} />
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      {lightboxOpen && document.file_url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Vergrößerte Ansicht: ${document.title}`}
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between gap-4">
              <span className="text-sm font-semibold text-neutral-100 truncate">{document.title}</span>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                aria-label="Vergrößerte Ansicht schließen"
                className="p-1.5 text-neutral-400 hover:text-neutral-100 rounded-lg hover:bg-neutral-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(90vh-3.5rem)] bg-neutral-950 p-4 flex justify-center">
              <img
                src={document.file_url}
                alt={document.title}
                referrerPolicy="no-referrer"
                className="max-w-full h-auto rounded border border-neutral-800"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
