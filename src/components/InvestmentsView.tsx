import React, { useMemo, useState } from 'react';
import {
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { DocumentRecord, InvestmentInput, InvestmentRecord } from '../types';
import {
  computePortfolioSummary,
  formatCurrencyCents,
  parseEuroInputToCents,
} from '../utils/documentLogic';
import { EtfChartWidget } from './EtfChartWidget';

interface InvestmentsViewProps {
  investments: InvestmentRecord[];
  contracts: DocumentRecord[];
  onOpenContract: (contractId: string) => void;
  onRefreshMarket: () => Promise<{ warnings?: string[] }>;
  onCreateInvestment: (payload: InvestmentInput) => Promise<void>;
  onUpdateInvestment: (id: string, patch: Partial<InvestmentInput>) => Promise<void>;
  onDeleteInvestment: (id: string) => Promise<void>;
}

export const InvestmentsView: React.FC<InvestmentsViewProps> = ({
  investments,
  contracts,
  onOpenContract,
  onRefreshMarket,
  onCreateInvestment,
  onUpdateInvestment,
  onDeleteInvestment,
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingInv, setEditingInv] = useState<InvestmentRecord | null>(null);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [isin, setIsin] = useState('');
  const [assetType, setAssetType] = useState<'ETF' | 'Aktie' | 'Fonds' | 'Anleihe'>('ETF');
  const [contractId, setContractId] = useState('');
  const [sharesInput, setSharesInput] = useState('');
  const [avgPriceInput, setAvgPriceInput] = useState('');
  const [currentPriceInput, setCurrentPriceInput] = useState('');
  const [monthlyInput, setMonthlyInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const portfolioSummary = useMemo(
    () => computePortfolioSummary(investments),
    [investments],
  );

  const handleRefreshClick = async () => {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const res = await onRefreshMarket();
      if (res.warnings && res.warnings.length > 0) {
        setRefreshMessage({
          type: 'info',
          text: `Teilweise aktualisiert: ${res.warnings[0]}`,
        });
      } else {
        setRefreshMessage({
          type: 'info',
          text: 'Alle ETF-Kurse wurden aktuell abgerufen.',
        });
      }
    } catch (err) {
      setRefreshMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Live-Kursabruf derzeit nicht erreichbar.',
      });
    } finally {
      setRefreshing(false);
    }
  };

  const openCreateModal = () => {
    setEditingInv(null);
    setName('');
    setSymbol('');
    setIsin('');
    setAssetType('ETF');
    setContractId(contracts[0]?.id || '');
    setSharesInput('');
    setAvgPriceInput('');
    setCurrentPriceInput('');
    setMonthlyInput('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (inv: InvestmentRecord) => {
    setEditingInv(inv);
    setName(inv.name);
    setSymbol(inv.symbol);
    setIsin(inv.isin);
    setAssetType(inv.asset_type);
    setContractId(inv.contract_id || '');
    setSharesInput(String(inv.shares).replace('.', ','));
    setAvgPriceInput((inv.avg_buy_price_cents / 100).toFixed(2).replace('.', ','));
    setCurrentPriceInput((inv.current_price_cents / 100).toFixed(2).replace('.', ','));
    setMonthlyInput(
      inv.monthly_savings_cents ? (inv.monthly_savings_cents / 100).toFixed(2).replace('.', ',') : '',
    );
    setFormError(null);
    setModalOpen(true);
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const shares = Number.parseFloat(sharesInput.replace(',', '.'));
    if (!name.trim() || !symbol.trim() || !Number.isFinite(shares) || shares < 0) {
      setFormError('Bitte Name, Ticker-Symbol (z. B. EUNL.DE) und gültige Anteile angeben.');
      return;
    }

    const payload: InvestmentInput = {
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      isin: isin.trim().toUpperCase(),
      asset_type: assetType,
      contract_id: contractId || null,
      shares,
      avg_buy_price_cents: parseEuroInputToCents(avgPriceInput),
      current_price_cents: parseEuroInputToCents(currentPriceInput || avgPriceInput),
      currency: 'EUR',
      monthly_savings_cents: parseEuroInputToCents(monthlyInput),
    };

    setSaving(true);
    setFormError(null);
    try {
      if (editingInv) {
        await onUpdateInvestment(editingInv.id, payload);
      } else {
        await onCreateInvestment(payload);
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const isPositive = portfolioSummary.totalGainCents >= 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-neutral-50 tracking-tight">
            ETF-Entwicklung
          </h1>
          <p className="mt-0.5 text-xs text-neutral-400">
            Wertentwicklung deiner in Depotverträgen hinterlegten ETFs und Sparpläne.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={refreshing}
            onClick={handleRefreshClick}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-200 bg-neutral-900 border border-neutral-700 rounded-lg hover:border-yellow-400/60 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-yellow-400 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{refreshing ? 'Aktualisiere Kurse…' : 'Live-Kurse aktualisieren'}</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-950 bg-yellow-400 rounded-lg hover:bg-yellow-300 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>ETF hinzufügen</span>
          </button>
        </div>
      </div>

      {refreshMessage && (
        <div
          role={refreshMessage.type === 'error' ? 'alert' : 'status'}
          className={`px-4 py-2.5 rounded-lg border text-xs flex items-center justify-between gap-3 ${
            refreshMessage.type === 'error'
              ? 'bg-red-950/50 border-red-900 text-red-200'
              : 'bg-neutral-900 border-yellow-400/40 text-yellow-300'
          }`}
        >
          <span>{refreshMessage.text}</span>
          <button
            type="button"
            onClick={() => setRefreshMessage(null)}
            aria-label="Hinweis schließen"
            className="p-0.5 hover:opacity-80"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Summary Strip */}
      <section
        aria-label="ETF-Übersicht"
        className="bg-neutral-900 border border-neutral-800 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-neutral-800"
      >
        <div className="p-4">
          <span className="block text-xs text-neutral-400">Aktueller Depotwert</span>
          <span className="mt-1 block text-xl font-bold font-mono tabular-nums text-neutral-50">
            {formatCurrencyCents(portfolioSummary.totalValueCents)}
          </span>
        </div>
        <div className="p-4">
          <span className="block text-xs text-neutral-400">Einstandswert</span>
          <span className="mt-1 block text-xl font-bold font-mono tabular-nums text-neutral-200">
            {formatCurrencyCents(portfolioSummary.totalCostCents)}
          </span>
        </div>
        <div className="p-4">
          <span className="block text-xs text-neutral-400">Entwicklung</span>
          <span className={`mt-1 block text-xl font-bold font-mono tabular-nums ${isPositive ? 'text-yellow-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}
            {portfolioSummary.totalGainPercent.toFixed(2).replace('.', ',')} %
          </span>
        </div>
        <div className="p-4">
          <span className="block text-xs text-neutral-400">Sparrate / Monat</span>
          <span className="mt-1 block text-xl font-bold font-mono tabular-nums text-neutral-200">
            {formatCurrencyCents(portfolioSummary.monthlySavingsTotalCents)}
          </span>
        </div>
      </section>

      {/* Main Chart Card */}
      <section
        aria-label="ETF-Entwicklungsgraf"
        className="bg-neutral-900 border border-neutral-800 rounded-xl p-5"
      >
        <EtfChartWidget investments={investments} />
      </section>

      {/* Positions Table */}
      <section
        aria-label="Hinterlegte ETF-Positionen"
        className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">
            Positionen &amp; Verknüpfte Verträge ({investments.length})
          </h2>
          <span className="text-xs text-neutral-500">
            Gestrichelte Linie = Einstandswert
          </span>
        </div>

        {investments.length === 0 ? (
          <div className="px-6 py-10 text-center space-y-3">
            <p className="text-sm text-neutral-300">Noch keine ETFs hinterlegt.</p>
            <button
              type="button"
              onClick={openCreateModal}
              className="px-4 py-2 text-xs font-semibold text-neutral-950 bg-yellow-400 rounded-lg hover:bg-yellow-300"
            >
              Ersten ETF hinzufügen
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-950/50 text-xs font-semibold text-neutral-400">
                  <th className="py-3 px-4">ETF / Wertpapier</th>
                  <th className="py-3 px-3 text-right">Anteile</th>
                  <th className="py-3 px-3 text-right">Akt. Kurs</th>
                  <th className="py-3 px-3 text-right">Gesamtwert</th>
                  <th className="py-3 px-3 text-right">Entwicklung</th>
                  <th className="py-3 px-3">Verknüpfter Vertrag</th>
                  <th className="py-3 px-4 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/80 text-sm">
                {investments.map((inv) => {
                  const marketVal = Math.round(inv.shares * inv.current_price_cents);
                  const costVal = Math.round(inv.shares * inv.avg_buy_price_cents);
                  const gainCents = marketVal - costVal;
                  const gainPct = costVal > 0 ? (gainCents / costVal) * 100 : 0;
                  const pos = gainCents >= 0;

                  return (
                    <tr key={inv.id} className="hover:bg-neutral-800/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-neutral-100">{inv.name}</div>
                        <div className="text-xs text-neutral-400 font-mono">
                          {inv.symbol}
                          {inv.isin ? ` · ${inv.isin}` : ''}
                          {inv.monthly_savings_cents > 0
                            ? ` · Sparplan ${formatCurrencyCents(inv.monthly_savings_cents)}/Monat`
                            : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums text-neutral-200">
                        {inv.shares.toLocaleString('de-DE', { maximumFractionDigits: 4 })}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums text-neutral-200">
                        <div>{formatCurrencyCents(inv.current_price_cents, inv.currency)}</div>
                        <div className="text-[11px] text-neutral-500">{inv.price_source}</div>
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums font-semibold text-neutral-50">
                        {formatCurrencyCents(marketVal, inv.currency)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                        <div className={pos ? 'text-yellow-400' : 'text-red-400'}>
                          {pos ? '+' : ''}
                          {formatCurrencyCents(gainCents, inv.currency)}
                        </div>
                        <div className={`text-xs ${pos ? 'text-yellow-300/90' : 'text-red-400/90'}`}>
                          {pos ? '+' : ''}
                          {gainPct.toFixed(1).replace('.', ',')} %
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        {inv.contract_id && inv.contract_title ? (
                          <button
                            type="button"
                            onClick={() => onOpenContract(inv.contract_id!)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-yellow-400 hover:underline text-left"
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate max-w-[180px]">{inv.contract_title}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-neutral-500">Kein Vertrag verknüpft</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(inv)}
                            aria-label={`${inv.name} bearbeiten`}
                            className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-md"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteInvestment(inv.id)}
                            aria-label={`${inv.name} löschen`}
                            className="p-1.5 text-neutral-400 hover:text-red-400 hover:bg-neutral-800 rounded-md"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add / Edit Investment Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="investment-modal-title"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
              <h2 id="investment-modal-title" className="text-base font-semibold text-neutral-100">
                {editingInv ? 'ETF bearbeiten' : 'Neuen ETF hinzufügen'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Dialog schließen"
                className="p-1.5 text-neutral-400 hover:text-neutral-100 rounded-lg hover:bg-neutral-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleModalSubmit} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="sm:col-span-2">
                  <label htmlFor="inv-name-input" className="block text-xs font-medium text-neutral-300 mb-1">
                    Bezeichnung *
                  </label>
                  <input
                    id="inv-name-input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="z. B. iShares Core MSCI World UCITS ETF"
                    className="w-full px-3 py-2 text-sm bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>

                <div>
                  <label htmlFor="inv-symbol-input" className="block text-xs font-medium text-neutral-300 mb-1">
                    Ticker-Symbol *
                  </label>
                  <input
                    id="inv-symbol-input"
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder="z. B. EUNL.DE"
                    className="w-full px-3 py-2 text-sm font-mono bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>

                <div>
                  <label htmlFor="inv-isin-input" className="block text-xs font-medium text-neutral-300 mb-1">
                    ISIN
                  </label>
                  <input
                    id="inv-isin-input"
                    type="text"
                    value={isin}
                    onChange={(e) => setIsin(e.target.value)}
                    placeholder="z. B. IE00B4L5Y983"
                    className="w-full px-3 py-2 text-sm font-mono bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>

                <div>
                  <label htmlFor="inv-shares-input" className="block text-xs font-medium text-neutral-300 mb-1">
                    Anteile *
                  </label>
                  <input
                    id="inv-shares-input"
                    type="text"
                    inputMode="decimal"
                    value={sharesInput}
                    onChange={(e) => setSharesInput(e.target.value)}
                    placeholder="z. B. 25,5"
                    className="w-full px-3 py-2 text-sm font-mono bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>

                <div>
                  <label htmlFor="inv-avg-input" className="block text-xs font-medium text-neutral-300 mb-1">
                    Ø Kaufkurs (EUR)
                  </label>
                  <input
                    id="inv-avg-input"
                    type="text"
                    inputMode="decimal"
                    value={avgPriceInput}
                    onChange={(e) => setAvgPriceInput(e.target.value)}
                    placeholder="z. B. 88,40"
                    className="w-full px-3 py-2 text-sm font-mono bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>

                <div>
                  <label htmlFor="inv-curr-input" className="block text-xs font-medium text-neutral-300 mb-1">
                    Aktueller Kurs (EUR)
                  </label>
                  <input
                    id="inv-curr-input"
                    type="text"
                    inputMode="decimal"
                    value={currentPriceInput}
                    onChange={(e) => setCurrentPriceInput(e.target.value)}
                    placeholder="z. B. 103,85"
                    className="w-full px-3 py-2 text-sm font-mono bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>

                <div>
                  <label htmlFor="inv-monthly-input" className="block text-xs font-medium text-neutral-300 mb-1">
                    Sparplan / Monat (EUR)
                  </label>
                  <input
                    id="inv-monthly-input"
                    type="text"
                    inputMode="decimal"
                    value={monthlyInput}
                    onChange={(e) => setMonthlyInput(e.target.value)}
                    placeholder="z. B. 300,00"
                    className="w-full px-3 py-2 text-sm font-mono bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="inv-contract-select" className="block text-xs font-medium text-neutral-300 mb-1">
                    Verknüpfter Vertrag im Archiv
                  </label>
                  <select
                    id="inv-contract-select"
                    value={contractId}
                    onChange={(e) => setContractId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-neutral-950 text-neutral-100 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    <option value="">Kein Vertrag verknüpft</option>
                    {contracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} ({c.vendor})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {formError && (
                <p role="alert" className="text-xs text-red-300 bg-red-950/50 border border-red-900 rounded-md px-3 py-2">
                  {formError}
                </p>
              )}

              <div className="pt-2 border-t border-neutral-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-neutral-300 bg-neutral-800 rounded-lg hover:bg-neutral-700"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-neutral-950 bg-yellow-400 rounded-lg hover:bg-yellow-300 disabled:opacity-50"
                >
                  {saving ? 'Speichere…' : 'Speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
