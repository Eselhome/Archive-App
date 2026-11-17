import React from 'react';
import { ExternalLink, FilePlus2, FileText, FolderGit2, Search, TrendingUp } from 'lucide-react';
import type { DocumentRecord, InvestmentRecord } from '../types';
import {
  buildPreviewSummary,
  formatCurrencyCents,
  formatGermanDate,
} from '../utils/documentLogic';
import { HighlightText } from './HighlightText';

interface DocumentPreviewPaneProps {
  document: DocumentRecord | null;
  allDocuments: DocumentRecord[];
  investments: InvestmentRecord[];
  searchQuery: string;
  onOpenWindow: (doc: DocumentRecord) => void;
  onAttachMonthlyFile: (contractId: string) => void;
}

export const DocumentPreviewPane: React.FC<DocumentPreviewPaneProps> = ({
  document,
  allDocuments,
  investments,
  searchQuery,
  onOpenWindow,
  onAttachMonthlyFile,
}) => {
  if (!document) {
    return (
      <aside
        aria-label="Kurzvorschau"
        className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[240px]"
      >
        <div className="w-10 h-10 rounded-lg bg-neutral-800 text-neutral-400 flex items-center justify-center mb-3">
          <FileText className="w-4 h-4" />
        </div>
        <h2 className="text-sm font-semibold text-neutral-200">Keine Auswahl</h2>
        <p className="mt-1 text-xs text-neutral-400 max-w-xs leading-relaxed">
          Klicke auf einen Eintrag, um Details im Fenster zu öffnen.
        </p>
      </aside>
    );
  }

  const previewSummary = buildPreviewSummary(document, searchQuery);
  const childCount = allDocuments.filter((d) => d.parent_id === document.id).length;
  const linkedInvCount = investments.filter((inv) => inv.contract_id === document.id).length;

  return (
    <aside
      aria-label="Kurzvorschau"
      className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-4"
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs text-neutral-400">
          <span className="font-medium text-yellow-400">
            {document.doc_type} · {formatGermanDate(document.doc_date)}
          </span>
          {document.amount_cents !== null && (
            <span className="font-mono tabular-nums text-neutral-200 font-medium">
              {formatCurrencyCents(document.amount_cents, document.currency)}
            </span>
          )}
        </div>
        <h2 className="text-sm font-semibold text-neutral-50 leading-snug break-words">
          <HighlightText text={document.title} query={searchQuery} />
        </h2>
        <p className="text-xs text-neutral-400">
          <HighlightText text={document.vendor} query={searchQuery} />
        </p>
      </div>

      {/* Search Context Hits */}
      {searchQuery.trim() && previewSummary.matchedExcerpts.length > 0 && (
        <div className="bg-neutral-950 border border-yellow-400/30 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-yellow-400">
            <Search className="w-3 h-3" aria-hidden="true" />
            <span>Treffer für „{searchQuery.trim()}“</span>
          </div>
          {previewSummary.matchedExcerpts.slice(0, 2).map((match, idx) => (
            <p key={idx} className="text-xs text-neutral-300 leading-relaxed line-clamp-2">
              <span className="text-neutral-500">{match.fieldLabel}: </span>
              <HighlightText text={match.snippet} query={searchQuery} />
            </p>
          ))}
        </div>
      )}

      {/* Minimal Summary */}
      <div className="bg-neutral-950/70 border border-neutral-800 rounded-lg p-3">
        <span className="block text-[11px] font-medium text-neutral-400 mb-1">
          Inhaltszusammenfassung
        </span>
        <p className="text-xs text-neutral-200 leading-relaxed line-clamp-4">
          <HighlightText text={previewSummary.headline} query={searchQuery} />
        </p>
      </div>

      {(document.doc_type === 'Vertrag' || document.parent_title) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
          {document.doc_type === 'Vertrag' && (
            <span className="inline-flex items-center gap-1">
              <FolderGit2 className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
              <span>{childCount} Monatsdateien</span>
            </span>
          )}
          {linkedInvCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
              <span>{linkedInvCount} ETFs hinterlegt</span>
            </span>
          )}
          {document.parent_title && (
            <span className="truncate">zu {document.parent_title}</span>
          )}
        </div>
      )}

      <div className="pt-2 border-t border-neutral-800 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenWindow(document)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-neutral-950 bg-yellow-400 hover:bg-yellow-300 rounded-lg transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Fenster öffnen</span>
        </button>

        {document.doc_type === 'Vertrag' && (
          <button
            type="button"
            onClick={() => onAttachMonthlyFile(document.id)}
            aria-label="Monatsdatei anhängen"
            className="inline-flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors"
          >
            <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Monatsdatei</span>
          </button>
        )}
      </div>
    </aside>
  );
};
