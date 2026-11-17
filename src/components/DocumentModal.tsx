import React, { useEffect, useState } from 'react';
import { RefreshCw, Sparkles, Upload, X } from 'lucide-react';
import type {
  DocumentInput,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
} from '../types';
import {
  parseOptionalEuroInputToCents,
  validateDocumentInput,
} from '../utils/documentLogic';

interface DocumentModalProps {
  isOpen: boolean;
  editingDocument: DocumentRecord | null;
  defaultParentId?: string | null;
  contracts: DocumentRecord[];
  onClose: () => void;
  onAutoImport: (file: File | null, rawText: string, parentId?: string | null) => Promise<void>;
  onSaveEdit: (payload: DocumentInput, editingId: string) => Promise<void>;
}

export const DocumentModal: React.FC<DocumentModalProps> = ({
  isOpen,
  editingDocument,
  defaultParentId = null,
  contracts,
  onClose,
  onAutoImport,
  onSaveEdit,
}) => {
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocumentType>('Kaufbeleg');
  const [vendor, setVendor] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountInput, setAmountInput] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [status, setStatus] = useState<DocumentStatus>('Archiviert');
  const [summary, setSummary] = useState('');
  const [extractedText, setExtractedText] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const [rawTextInput, setRawTextInput] = useState('');
  const [showTextMode, setShowTextMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setSubmitError(null);
    setRawTextInput('');
    setShowTextMode(false);
    setIsDragging(false);

    if (editingDocument) {
      setTitle(editingDocument.title);
      setDocType(editingDocument.doc_type);
      setVendor(editingDocument.vendor);
      setDocNumber(editingDocument.doc_number);
      setDocDate(editingDocument.doc_date);
      setAmountInput(
        editingDocument.amount_cents !== null
          ? (editingDocument.amount_cents / 100).toFixed(2).replace('.', ',')
          : '',
      );
      setParentId(editingDocument.parent_id || '');
      setStatus(editingDocument.status);
      setSummary(editingDocument.summary || editingDocument.ai_summary || '');
      setExtractedText(editingDocument.extracted_text || '');
      setTagsInput(editingDocument.tags.join(', '));
    } else {
      setParentId(defaultParentId || '');
    }
  }, [isOpen, editingDocument, defaultParentId]);

  if (!isOpen) return null;

  const runAutoImport = async (file: File | null, text = '') => {
    if (!file && !text.trim()) return;
    setImporting(true);
    setSubmitError(null);
    try {
      await onAutoImport(file, text.trim(), parentId || defaultParentId || null);
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Dokument konnte nicht automatisch ausgelesen werden.',
      );
    } finally {
      setImporting(false);
    }
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      void runAutoImport(file, '');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0] ?? null;
    if (file) {
      void runAutoImport(file, '');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDocument) return;
    setSubmitError(null);

    const amountCents = parseOptionalEuroInputToCents(amountInput);
    const payload: DocumentInput = {
      title: title.trim(),
      doc_type: docType,
      vendor: vendor.trim(),
      doc_number: docNumber.trim(),
      doc_date: docDate,
      amount_cents: amountCents,
      tax_cents: null,
      currency: 'EUR',
      category_id: editingDocument.category_id,
      parent_id: parentId || null,
      status,
      summary: summary.trim(),
      ai_summary: summary.trim(),
      extracted_text: extractedText.trim(),
      line_items: editingDocument.line_items || [],
      tags: tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };

    const validationErrors = validateDocumentInput(payload);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      await onSaveEdit(payload, editingDocument.id);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Fehler beim Speichern.');
    } finally {
      setSaving(false);
    }
  };

  const parentContract = contracts.find((c) => c.id === (parentId || defaultParentId));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-modal-title"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between gap-4">
          <h2 id="document-modal-title" className="text-base font-semibold text-neutral-100">
            {editingDocument ? 'Dokument bearbeiten' : 'Dokument einfügen'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dialog schließen"
            className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!editingDocument ? (
          <div className="p-6 space-y-5 overflow-y-auto">
            {parentContract && (
              <div className="bg-neutral-950 border border-yellow-400/30 rounded-lg px-3.5 py-2.5 text-xs text-neutral-300">
                Wird automatisch als Monatsdatei an{' '}
                <span className="font-semibold text-yellow-400">{parentContract.title}</span> angehängt.
              </div>
            )}

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                isDragging
                  ? 'border-yellow-400 bg-neutral-800/70'
                  : 'border-neutral-700 bg-neutral-950/70 hover:border-yellow-400/60'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-neutral-900 border border-neutral-800 text-yellow-400 flex items-center justify-center mx-auto mb-3">
                {importing ? (
                  <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="w-5 h-5" aria-hidden="true" />
                )}
              </div>

              <h3 className="text-sm font-semibold text-neutral-100">
                {importing
                  ? 'Dokument wird automatisch ausgelesen…'
                  : 'Datei hier ablegen oder auswählen'}
              </h3>
              <p className="mt-1 text-xs text-neutral-400 max-w-sm mx-auto leading-relaxed">
                PDF, Foto oder Textdatei einfügen — Dokumenttyp, Aussteller, Datum und Zusammenfassung werden automatisch erkannt.
              </p>

              <div className="mt-4">
                <label
                  htmlFor="auto-import-file-input"
                  className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-neutral-950 bg-yellow-400 hover:bg-yellow-300 rounded-lg cursor-pointer transition-colors ${
                    importing ? 'opacity-50 pointer-events-none' : ''
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Datei wählen &amp; automatisch archivieren</span>
                  <input
                    id="auto-import-file-input"
                    type="file"
                    disabled={importing}
                    accept="image/*,application/pdf,text/plain,text/csv"
                    onChange={handleFilePicked}
                    className="sr-only"
                  />
                </label>
              </div>
            </div>

            <div className="border-t border-neutral-800 pt-4 space-y-3">
              <button
                type="button"
                onClick={() => setShowTextMode((v) => !v)}
                className="text-xs font-medium text-neutral-400 hover:text-yellow-400 underline"
              >
                {showTextMode ? 'Texteingabe ausblenden' : 'Oder Text direkt einfügen'}
              </button>

              {showTextMode && (
                <div className="space-y-3">
                  <textarea
                    rows={4}
                    aria-label="Dokumenttext zum automatischen Auslesen"
                    value={rawTextInput}
                    onChange={(e) => setRawTextInput(e.target.value)}
                    placeholder="Bestellbestätigung, Vertragsdaten oder Zeugnistext hier einfügen…"
                    className="w-full px-3 py-2 text-xs font-mono bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={importing || !rawTextInput.trim()}
                      onClick={() => void runAutoImport(null, rawTextInput)}
                      className="px-4 py-2 text-xs font-semibold text-neutral-950 bg-yellow-400 hover:bg-yellow-300 rounded-lg disabled:opacity-50"
                    >
                      {importing ? 'Lese aus…' : 'Text auslesen & archivieren'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {submitError && (
              <p role="alert" className="text-xs text-red-300 bg-red-950/50 border border-red-900 rounded-md px-3 py-2">
                {submitError}
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleEditSubmit} className="p-6 space-y-4 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="doc-title-input" className="block text-xs font-medium text-neutral-300 mb-1">
                  Dokumenttitel *
                </label>
                <input
                  id="doc-title-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
                {errors.title && <p className="mt-1 text-xs text-red-400">{errors.title}</p>}
              </div>

              <div>
                <label htmlFor="doc-vendor-input" className="block text-xs font-medium text-neutral-300 mb-1">
                  Aussteller / Shop / Institution *
                </label>
                <input
                  id="doc-vendor-input"
                  type="text"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
                {errors.vendor && <p className="mt-1 text-xs text-red-400">{errors.vendor}</p>}
              </div>

              <div>
                <label htmlFor="doc-number-input" className="block text-xs font-medium text-neutral-300 mb-1">
                  Bestell-, Vertrags- oder Aktennr.
                </label>
                <input
                  id="doc-number-input"
                  type="text"
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>

              <div>
                <label htmlFor="doc-type-select" className="block text-xs font-medium text-neutral-300 mb-1">
                  Dokumenttyp *
                </label>
                <select
                  id="doc-type-select"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocumentType)}
                  className="w-full px-3 py-2 text-sm bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  <option value="Kaufbeleg">Kaufbeleg</option>
                  <option value="Vertrag">Vertrag</option>
                  <option value="Monatsbeleg">Monatsbeleg (zum Vertrag)</option>
                  <option value="Zeugnis">Zeugnis / Urkunde</option>
                  <option value="Sonstiges">Sonstiges</option>
                </select>
              </div>

              <div>
                <label htmlFor="doc-status-select" className="block text-xs font-medium text-neutral-300 mb-1">
                  Status
                </label>
                <select
                  id="doc-status-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as DocumentStatus)}
                  className="w-full px-3 py-2 text-sm bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  <option value="Archiviert">Archiviert</option>
                  <option value="Aktiv">Aktiv</option>
                  <option value="Offen">Offen</option>
                  <option value="Prüfung">Prüfung</option>
                </select>
              </div>

              {contracts.length > 0 && docType !== 'Vertrag' && (
                <div className="sm:col-span-2">
                  <label htmlFor="doc-parent-select" className="block text-xs font-medium text-neutral-300 mb-1">
                    Zugehöriger Vertrag (optional)
                  </label>
                  <select
                    id="doc-parent-select"
                    value={parentId}
                    onChange={(e) => setParentId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="">Keinem Vertrag zugeordnet</option>
                    {contracts
                      .filter((c) => c.id !== editingDocument.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} ({c.vendor})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="doc-date-input" className="block text-xs font-medium text-neutral-300 mb-1">
                  Dokumentdatum *
                </label>
                <input
                  id="doc-date-input"
                  type="date"
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>

              <div>
                <label htmlFor="doc-amount-input" className="block text-xs font-medium text-neutral-300 mb-1">
                  Vermerkter Preis in EUR (optional)
                </label>
                <input
                  id="doc-amount-input"
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 text-sm font-mono bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="doc-summary-input" className="block text-xs font-medium text-neutral-300 mb-1">
                  Inhaltszusammenfassung
                </label>
                <textarea
                  id="doc-summary-input"
                  rows={2}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="doc-tags-input" className="block text-xs font-medium text-neutral-300 mb-1">
                  Schlagwörter (kommagetrennt)
                </label>
                <input
                  id="doc-tags-input"
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
            </div>

            {submitError && (
              <p role="alert" className="text-xs text-red-300 bg-red-950/50 border border-red-900 rounded-md px-3 py-2">
                {submitError}
              </p>
            )}

            <div className="pt-3 border-t border-neutral-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-neutral-300 bg-neutral-800 border border-neutral-700 rounded-lg hover:bg-neutral-700"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold text-neutral-950 bg-yellow-400 rounded-lg hover:bg-yellow-300 disabled:opacity-50"
              >
                {saving ? 'Speichere…' : 'Änderungen speichern'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
