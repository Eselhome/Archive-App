import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { InvestmentRecord } from '../types';
import {
  buildCombinedPortfolioSeries,
  computePortfolioSummary,
  formatCurrencyCents,
  formatGermanDate,
} from '../utils/documentLogic';

interface EtfChartWidgetProps {
  investments: InvestmentRecord[];
  onRefreshMarket?: () => Promise<{ warnings?: string[] }>;
  compact?: boolean;
  title?: string;
}

export const EtfChartWidget: React.FC<EtfChartWidgetProps> = ({
  investments,
  onRefreshMarket,
  compact = false,
  title,
}) => {
  const [rangeDays, setRangeDays] = useState<30 | 90 | 180>(180);
  const [selectedAssetId, setSelectedAssetId] = useState<string | 'ALL'>('ALL');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);

  const activeInvestments = useMemo(() => {
    if (selectedAssetId === 'ALL') return investments;
    return investments.filter((inv) => inv.id === selectedAssetId);
  }, [investments, selectedAssetId]);

  const summary = useMemo(
    () => computePortfolioSummary(activeInvestments),
    [activeInvestments],
  );

  const series = useMemo(
    () => buildCombinedPortfolioSeries(activeInvestments, rangeDays),
    [activeInvestments, rangeDays],
  );

  const chartDimensions = {
    width: 760,
    height: compact ? 180 : 230,
    padX: 16,
    padTop: 16,
    padBottom: 24,
  };
  const plotW = chartDimensions.width - chartDimensions.padX * 2;
  const plotH = chartDimensions.height - chartDimensions.padTop - chartDimensions.padBottom;

  const chartMath = useMemo(() => {
    if (series.length < 2) return null;
    const allVals = series.flatMap((pt) => [pt.valueCents, pt.costCents]);
    const minRaw = Math.min(...allVals);
    const maxRaw = Math.max(...allVals);
    const span = Math.max(100, maxRaw - minRaw);
    const minVal = minRaw - span * 0.12;
    const maxVal = maxRaw + span * 0.12;

    const coords = series.map((pt, i) => {
      const x = chartDimensions.padX + (i / (series.length - 1)) * plotW;
      const y =
        chartDimensions.padTop +
        plotH -
        ((pt.valueCents - minVal) / (maxVal - minVal)) * plotH;
      const costY =
        chartDimensions.padTop +
        plotH -
        ((pt.costCents - minVal) / (maxVal - minVal)) * plotH;
      return { x, y, costY, ...pt };
    });

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(' ');
    const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(
      chartDimensions.padTop + plotH
    ).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(chartDimensions.padTop + plotH).toFixed(1)} Z`;

    return { coords, linePath, areaPath, costY: coords[0].costY };
  }, [series, plotW, plotH, chartDimensions.padX, chartDimensions.padTop]);

  const activePoint =
    chartMath && hoverIndex !== null && chartMath.coords[hoverIndex]
      ? chartMath.coords[hoverIndex]
      : chartMath
        ? chartMath.coords[chartMath.coords.length - 1]
        : null;

  const isPositive = summary.totalGainCents >= 0;
  const gradientId = useMemo(
    () => `etfYellowGrad-${compact ? 'c' : 'f'}`,
    [compact],
  );

  const handleRefresh = async () => {
    if (!onRefreshMarket) return;
    setRefreshing(true);
    setRefreshStatus(null);
    try {
      const res = await onRefreshMarket();
      setRefreshStatus(
        res.warnings && res.warnings.length > 0
          ? `Hinweis: ${res.warnings[0]}`
          : 'Kurse aktuell abgerufen.',
      );
    } catch (err) {
      setRefreshStatus(err instanceof Error ? err.message : 'Abruf fehlgeschlagen.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {title && (
            <span className="text-xs font-semibold text-neutral-200">{title}</span>
          )}
          {investments.length > 1 && (
            <>
              <label htmlFor={`etf-select-${compact ? 'c' : 'f'}`} className="sr-only">
                ETF auswählen
              </label>
              <select
                id={`etf-select-${compact ? 'c' : 'f'}`}
                value={selectedAssetId}
                onChange={(e) => {
                  setSelectedAssetId(e.target.value);
                  setHoverIndex(null);
                }}
                className="px-2.5 py-1.5 text-xs font-medium text-neutral-100 bg-neutral-950 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
              >
                <option value="ALL">Alle ETFs ({investments.length})</option>
                {investments.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.name} ({inv.symbol})
                  </option>
                ))}
              </select>
            </>
          )}

          {activePoint && (
            <div className="text-xs text-neutral-300 font-mono tabular-nums flex items-center gap-2">
              <span className="text-neutral-500">{formatGermanDate(activePoint.date)}:</span>
              <span className="font-semibold text-neutral-50">
                {formatCurrencyCents(activePoint.valueCents)}
              </span>
              <span className={activePoint.valueCents >= activePoint.costCents ? 'text-yellow-400' : 'text-red-400'}>
                ({activePoint.valueCents >= activePoint.costCents ? '+' : ''}
                {formatCurrencyCents(activePoint.valueCents - activePoint.costCents)} ·{' '}
                {isPositive ? '+' : ''}
                {summary.totalGainPercent.toFixed(1).replace('.', ',')} %)
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onRefreshMarket && (
            <button
              type="button"
              disabled={refreshing}
              onClick={handleRefresh}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-neutral-200 bg-neutral-950 border border-neutral-700 rounded-lg hover:border-yellow-400/60 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 text-yellow-400 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{refreshing ? 'Lädt…' : 'Aktualisieren'}</span>
            </button>
          )}

          <div className="flex items-center gap-1 p-0.5 bg-neutral-950 border border-neutral-800 rounded-lg">
            {([
              { label: '1M', days: 30 },
              { label: '3M', days: 90 },
              { label: '6M', days: 180 },
            ] as const).map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setRangeDays(r.days)}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                  rangeDays === r.days
                    ? 'bg-yellow-400 text-neutral-950 font-semibold'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {refreshStatus && (
        <p className="text-[11px] text-yellow-300/90 bg-neutral-950 border border-neutral-800 rounded-md px-2.5 py-1.5">
          {refreshStatus}
        </p>
      )}

      {chartMath ? (
        <div className="relative w-full">
          <svg
            viewBox={`0 0 ${chartDimensions.width} ${chartDimensions.height}`}
            className={`w-full ${compact ? 'h-40' : 'h-56'} overflow-visible select-none`}
            role="img"
            aria-label="Aktuelle ETF-Wertentwicklung"
            onMouseLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isPositive ? '#FACC15' : '#F87171'} stopOpacity="0.25" />
                <stop offset="100%" stopColor={isPositive ? '#FACC15' : '#F87171'} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {[0.25, 0.5, 0.75].map((ratio) => {
              const y = chartDimensions.padTop + plotH * ratio;
              return (
                <line
                  key={ratio}
                  x1={chartDimensions.padX}
                  x2={chartDimensions.width - chartDimensions.padX}
                  y1={y}
                  y2={y}
                  stroke="#262626"
                  strokeDasharray="3 4"
                  strokeWidth="1"
                />
              );
            })}

            {chartMath.costY >= chartDimensions.padTop &&
              chartMath.costY <= chartDimensions.padTop + plotH && (
                <line
                  x1={chartDimensions.padX}
                  x2={chartDimensions.width - chartDimensions.padX}
                  y1={chartMath.costY}
                  y2={chartMath.costY}
                  stroke="#525252"
                  strokeDasharray="4 4"
                  strokeWidth="1.2"
                />
              )}

            <path d={chartMath.areaPath} fill={`url(#${gradientId})`} />
            <path
              d={chartMath.linePath}
              fill="none"
              stroke={isPositive ? '#FACC15' : '#F87171'}
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {activePoint && (
              <>
                <line
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={chartDimensions.padTop}
                  y2={chartDimensions.padTop + plotH}
                  stroke="#525252"
                  strokeWidth="1"
                />
                <circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="4.5"
                  fill={isPositive ? '#FACC15' : '#F87171'}
                  stroke="#171717"
                  strokeWidth="2"
                />
              </>
            )}

            {[0, Math.floor(chartMath.coords.length / 2), chartMath.coords.length - 1].map(
              (idx) => {
                const pt = chartMath.coords[idx];
                if (!pt) return null;
                return (
                  <text
                    key={idx}
                    x={pt.x}
                    y={chartDimensions.height - 4}
                    textAnchor={idx === 0 ? 'start' : idx === chartMath.coords.length - 1 ? 'end' : 'middle'}
                    fill="#737373"
                    fontSize="11"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {formatGermanDate(pt.date)}
                  </text>
                );
              },
            )}

            {chartMath.coords.map((pt, idx) => {
              const colWidth = plotW / chartMath.coords.length;
              return (
                <rect
                  key={pt.date}
                  x={pt.x - colWidth / 2}
                  y={chartDimensions.padTop}
                  width={Math.max(8, colWidth)}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIndex(idx)}
                />
              );
            })}
          </svg>
        </div>
      ) : (
        <p className="text-xs text-neutral-400 py-5 text-center">
          Noch keine Kurspunkte vorhanden.
        </p>
      )}
    </div>
  );
};
