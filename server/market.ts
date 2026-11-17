import type { PricePoint } from '../src/types.ts';

interface YahooChartResult {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        currency?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string };
  };
}

export async function fetchMarketQuoteAndHistory(symbol: string): Promise<{
  currentPriceCents: number;
  currency: string;
  history: PricePoint[];
  priceSource: string;
}> {
  const cleanSymbol = symbol.trim().toUpperCase();
  if (!cleanSymbol) {
    throw new Error('Kein Börsen-Ticker-Symbol angegeben.');
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    cleanSymbol,
  )}?range=6mo&interval=1wk`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ArchiveServer/1.0)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Kursabruf für ${cleanSymbol} fehlgeschlagen (HTTP ${response.status}).`);
  }

  const payload = (await response.json()) as YahooChartResult;
  const result = payload.chart?.result?.[0];
  if (!result) {
    const desc = payload.chart?.error?.description || 'Symbol nicht gefunden';
    throw new Error(`Kursdaten für ${cleanSymbol} nicht verfügbar: ${desc}.`);
  }

  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const history: PricePoint[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const close = closes[i];
    if (typeof ts === 'number' && typeof close === 'number' && Number.isFinite(close) && close > 0) {
      history.push({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        priceCents: Math.round(close * 100),
      });
    }
  }

  const marketPrice = result.meta?.regularMarketPrice;
  const latestClose = history.length > 0 ? history[history.length - 1].priceCents : 0;
  const currentPriceCents =
    typeof marketPrice === 'number' && Number.isFinite(marketPrice) && marketPrice > 0
      ? Math.round(marketPrice * 100)
      : latestClose;

  if (currentPriceCents <= 0) {
    throw new Error(`Kein gültiger Kurs für ${cleanSymbol} empfangen.`);
  }

  return {
    currentPriceCents,
    currency: result.meta?.currency || 'EUR',
    history,
    priceSource: 'Yahoo Finance (Live)',
  };
}
