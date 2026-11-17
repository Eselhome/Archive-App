import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  UPLOADS_DIR,
  createCategory,
  createDocument,
  createInvestment,
  deleteCategory,
  deleteDocument,
  deleteInvestment,
  getDb,
  getDocumentById,
  getDocumentFileMeta,
  getInvestmentById,
  listCategories,
  listDocuments,
  listInvestments,
  updateDocument,
  updateInvestment,
} from './server/db.ts';
import {
  analyzeDocumentWithAutoFallback,
  analyzeDocumentWithGemini,
  summarizeDocumentWithGemini,
} from './server/ai.ts';
import { fetchMarketQuoteAndHistory } from './server/market.ts';
import type {
  DocumentInput,
  DocumentStatus,
  DocumentType,
  InvestmentInput,
  LineItem,
} from './src/types.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

getDb();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext.replace(/[^a-z0-9.]/g, '').slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${safeExt}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'Archive' });
});

app.get('/api/categories', (_req, res) => {
  try {
    res.json({ categories: listCategories() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Fehler beim Laden der Kategorien.' });
  }
});

app.post('/api/categories', (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const accent = typeof req.body?.accent === 'string' ? req.body.accent.trim() : '#A3A3A3';
    if (!name) {
      res.status(400).json({ error: 'Kategoriename darf nicht leer sein.' });
      return;
    }
    const category = createCategory(name, accent);
    res.status(201).json({ category });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kategorie konnte nicht erstellt werden.';
    const status = message.includes('UNIQUE') ? 409 : 500;
    res.status(status).json({
      error: status === 409 ? 'Eine Kategorie mit diesem Namen existiert bereits.' : message,
    });
  }
});

app.delete('/api/categories/:id', (req, res) => {
  try {
    const result = deleteCategory(req.params.id);
    if (!result.deleted) {
      res.status(400).json({ error: result.reason || 'Kategorie konnte nicht gelöscht werden.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Fehler beim Löschen der Kategorie.' });
  }
});

app.get('/api/documents', (_req, res) => {
  try {
    res.json({ documents: listDocuments() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Fehler beim Laden der Dokumente.' });
  }
});

app.get('/api/documents/:id', (req, res) => {
  try {
    const doc = getDocumentById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Dokument nicht gefunden.' });
      return;
    }
    res.json({ document: doc });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Fehler beim Laden des Dokuments.' });
  }
});

app.get('/api/documents/:id/file', (req, res) => {
  try {
    const meta = getDocumentFileMeta(req.params.id);
    if (!meta) {
      res.status(404).json({ error: 'Keine Datei für dieses Dokument hinterlegt.' });
      return;
    }
    if (meta.file_path.startsWith('/src/assets/')) {
      res.redirect(meta.file_path);
      return;
    }
    const absPath = path.join(UPLOADS_DIR, path.basename(meta.file_path));
    if (!fs.existsSync(absPath)) {
      res.status(404).json({ error: 'Datei auf dem Server nicht gefunden.' });
      return;
    }
    if (meta.file_mime) res.setHeader('Content-Type', meta.file_mime);
    if (meta.file_name) {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.file_name)}"`);
    }
    res.sendFile(absPath);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Fehler beim Ausliefern der Datei.' });
  }
});

function parseNullableInt(val: unknown): number | null {
  if (val === null || val === undefined || val === '' || val === 'null') return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseDocumentPayload(body: Record<string, unknown>): DocumentInput {
  const docTypeRaw = String(body.doc_type ?? 'Kaufbeleg');
  const doc_type: DocumentType =
    docTypeRaw === 'Kaufbeleg' ||
    docTypeRaw === 'Vertrag' ||
    docTypeRaw === 'Monatsbeleg' ||
    docTypeRaw === 'Zeugnis' ||
    docTypeRaw === 'Sonstiges'
      ? docTypeRaw
      : 'Kaufbeleg';

  const statusRaw = String(body.status ?? 'Archiviert');
  const status: DocumentStatus =
    statusRaw === 'Archiviert' || statusRaw === 'Aktiv' || statusRaw === 'Offen' || statusRaw === 'Prüfung'
      ? statusRaw
      : 'Archiviert';

  let line_items: LineItem[] = [];
  if (typeof body.line_items === 'string') {
    try {
      line_items = JSON.parse(body.line_items) as LineItem[];
    } catch {
      line_items = [];
    }
  } else if (Array.isArray(body.line_items)) {
    line_items = body.line_items as LineItem[];
  }

  let tags: string[] = [];
  if (typeof body.tags === 'string') {
    try {
      const parsed = JSON.parse(body.tags);
      tags = Array.isArray(parsed)
        ? parsed.map(String)
        : body.tags.split(',').map((s) => s.trim()).filter(Boolean);
    } catch {
      tags = body.tags.split(',').map((s) => s.trim()).filter(Boolean);
    }
  } else if (Array.isArray(body.tags)) {
    tags = body.tags.map(String).filter(Boolean);
  }

  const parentRaw = body.parent_id;
  const parent_id = typeof parentRaw === 'string' && parentRaw.trim() && parentRaw !== 'null' ? parentRaw.trim() : null;

  return {
    title: String(body.title ?? '').trim(),
    doc_type,
    vendor: String(body.vendor ?? '').trim(),
    doc_number: String(body.doc_number ?? '').trim(),
    doc_date: String(body.doc_date ?? new Date().toISOString().slice(0, 10)).trim(),
    amount_cents: parseNullableInt(body.amount_cents),
    tax_cents: parseNullableInt(body.tax_cents),
    currency: String(body.currency ?? 'EUR').trim() || 'EUR',
    category_id: String(body.category_id ?? '').trim(),
    parent_id,
    status,
    summary: String(body.summary ?? '').trim(),
    ai_summary: String(body.ai_summary ?? '').trim(),
    extracted_text: String(body.extracted_text ?? '').trim(),
    line_items,
    tags,
  };
}

app.post('/api/documents', upload.single('file'), (req, res) => {
  try {
    const payload = parseDocumentPayload((req.body ?? {}) as Record<string, unknown>);
    if (!payload.title || !payload.vendor || !payload.category_id || !/^\d{4}-\d{2}-\d{2}$/.test(payload.doc_date)) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Titel, Aussteller, gültiges Datum und Kategorie sind erforderlich.' });
      return;
    }

    let extractedText = payload.extracted_text;
    if (!extractedText && req.file && req.file.mimetype.startsWith('text/')) {
      try {
        extractedText = fs.readFileSync(req.file.path, 'utf8').slice(0, 20000);
      } catch {
        // Ignore read error
      }
    }

    const fileMeta = req.file
      ? {
          filePath: req.file.filename,
          fileName: req.file.originalname,
          fileMime: req.file.mimetype,
        }
      : null;

    const document = createDocument({ ...payload, extracted_text: extractedText }, fileMeta);
    res.status(201).json({ document });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Dokument konnte nicht gespeichert werden.' });
  }
});

app.post('/api/documents/auto-import', upload.single('file'), async (req, res) => {
  try {
    const rawText = typeof req.body?.rawText === 'string' ? req.body.rawText.trim() : '';
    if (!req.file && !rawText) {
      res.status(400).json({ error: 'Bitte eine Datei auswählen oder Text einfügen.' });
      return;
    }

    const categories = listCategories();
    const fileBuffer = req.file ? fs.readFileSync(req.file.path) : undefined;
    const { extraction, source } = await analyzeDocumentWithAutoFallback({
      fileBuffer,
      mimeType: req.file?.mimetype,
      fileName: req.file?.originalname,
      rawText: rawText || undefined,
      categories,
    });

    const requestedParentId =
      typeof req.body?.parent_id === 'string' && req.body.parent_id.trim()
        ? req.body.parent_id.trim()
        : null;

    const requestedCategoryId =
      typeof req.body?.category_id === 'string' && req.body.category_id.trim()
        ? req.body.category_id.trim()
        : null;

    const matchedCategory =
      (requestedCategoryId && categories.find((c) => c.id === requestedCategoryId)) ||
      categories.find(
        (c) => c.name.toLowerCase() === extraction.suggested_category_name.toLowerCase(),
      ) ||
      categories[0];

    if (!matchedCategory) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Keine Kategorie im Archiv vorhanden.' });
      return;
    }

    // Try matching parent contract automatically if it is a Monatsbeleg and no explicit parent was passed
    let resolvedParentId: string | null = requestedParentId;
    if (!resolvedParentId && extraction.doc_type === 'Monatsbeleg') {
      const contracts = listDocuments().filter((d) => d.doc_type === 'Vertrag');
      const vendorLower = extraction.vendor.toLowerCase();
      const firstVendorToken = vendorLower.split(/\s+/)[0] || '';
      const matchedContract = contracts.find(
        (c) =>
          (firstVendorToken.length >= 3 && c.vendor.toLowerCase().includes(firstVendorToken)) ||
          (firstVendorToken.length >= 3 && c.title.toLowerCase().includes(firstVendorToken)),
      );
      if (matchedContract) {
        resolvedParentId = matchedContract.id;
      }
    }

    const fileMeta = req.file
      ? {
          filePath: req.file.filename,
          fileName: req.file.originalname,
          fileMime: req.file.mimetype,
        }
      : null;

    const doc = createDocument(
      {
        title: extraction.title,
        doc_type: requestedParentId ? 'Monatsbeleg' : extraction.doc_type,
        vendor: extraction.vendor,
        doc_number: extraction.doc_number,
        doc_date: extraction.doc_date,
        amount_cents:
          extraction.amount_eur !== null ? Math.round(extraction.amount_eur * 100) : null,
        tax_cents: null,
        currency: 'EUR',
        category_id: matchedCategory.id,
        parent_id: resolvedParentId,
        status: extraction.status,
        summary: extraction.summary,
        ai_summary: extraction.summary,
        extracted_text: extraction.extracted_text,
        line_items: extraction.line_items,
        tags: extraction.tags,
      },
      fileMeta,
    );

    res.status(201).json({ document: doc, extractionSource: source });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Automatisches Auslesen fehlgeschlagen.',
    });
  }
});

app.patch('/api/documents/:id', (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const existing = getDocumentById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Dokument nicht gefunden.' });
      return;
    }

    const patch: Partial<DocumentInput> = {};
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.doc_type !== undefined) {
      const t = String(body.doc_type);
      if (t === 'Kaufbeleg' || t === 'Vertrag' || t === 'Monatsbeleg' || t === 'Zeugnis' || t === 'Sonstiges') {
        patch.doc_type = t;
      }
    }
    if (body.vendor !== undefined) patch.vendor = String(body.vendor);
    if (body.doc_number !== undefined) patch.doc_number = String(body.doc_number);
    if (body.doc_date !== undefined) patch.doc_date = String(body.doc_date);
    if (body.amount_cents !== undefined) patch.amount_cents = parseNullableInt(body.amount_cents);
    if (body.tax_cents !== undefined) patch.tax_cents = parseNullableInt(body.tax_cents);
    if (body.category_id !== undefined) patch.category_id = String(body.category_id);
    if (body.parent_id !== undefined) {
      patch.parent_id = typeof body.parent_id === 'string' && body.parent_id.trim() ? body.parent_id.trim() : null;
    }
    if (body.status !== undefined) {
      const s = String(body.status);
      if (s === 'Archiviert' || s === 'Aktiv' || s === 'Offen' || s === 'Prüfung') patch.status = s;
    }
    if (body.summary !== undefined) patch.summary = String(body.summary);
    if (body.ai_summary !== undefined) patch.ai_summary = String(body.ai_summary);
    if (body.extracted_text !== undefined) patch.extracted_text = String(body.extracted_text);
    if (Array.isArray(body.line_items)) patch.line_items = body.line_items as LineItem[];
    if (Array.isArray(body.tags)) patch.tags = body.tags.map(String);

    const updated = updateDocument(req.params.id, patch);
    res.json({ document: updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Dokument konnte nicht aktualisiert werden.' });
  }
});

app.delete('/api/documents/:id', (req, res) => {
  try {
    const removed = deleteDocument(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Dokument nicht gefunden.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Fehler beim Löschen.' });
  }
});

// Investments & ETF Tracker Routes
app.get('/api/investments', (_req, res) => {
  try {
    res.json({ investments: listInvestments() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Investments konnten nicht geladen werden.' });
  }
});

app.post('/api/investments', (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = String(body.name ?? '').trim();
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    if (!name || !symbol) {
      res.status(400).json({ error: 'Name und Börsen-Symbol (z. B. EUNL.DE) sind erforderlich.' });
      return;
    }
    const assetTypeRaw = String(body.asset_type ?? 'ETF');
    const asset_type =
      assetTypeRaw === 'ETF' || assetTypeRaw === 'Aktie' || assetTypeRaw === 'Fonds' || assetTypeRaw === 'Anleihe'
        ? assetTypeRaw
        : 'ETF';

    const input: InvestmentInput = {
      name,
      symbol,
      isin: String(body.isin ?? '').trim().toUpperCase(),
      asset_type,
      contract_id: typeof body.contract_id === 'string' && body.contract_id.trim() ? body.contract_id.trim() : null,
      shares: Number(body.shares ?? 0),
      avg_buy_price_cents: Number(body.avg_buy_price_cents ?? 0),
      current_price_cents: Number(body.current_price_cents ?? body.avg_buy_price_cents ?? 0),
      currency: String(body.currency ?? 'EUR').trim() || 'EUR',
      monthly_savings_cents: Number(body.monthly_savings_cents ?? 0),
    };

    const investment = createInvestment(input);
    res.status(201).json({ investment });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Investment konnte nicht angelegt werden.' });
  }
});

app.patch('/api/investments/:id', (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const existing = getInvestmentById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Investment nicht gefunden.' });
      return;
    }

    const patch: Partial<InvestmentInput> & { price_source?: string } = {};
    if (body.name !== undefined) patch.name = String(body.name);
    if (body.symbol !== undefined) patch.symbol = String(body.symbol);
    if (body.isin !== undefined) patch.isin = String(body.isin);
    if (body.shares !== undefined) patch.shares = Number(body.shares);
    if (body.avg_buy_price_cents !== undefined) patch.avg_buy_price_cents = Number(body.avg_buy_price_cents);
    if (body.current_price_cents !== undefined) {
      patch.current_price_cents = Number(body.current_price_cents);
      patch.price_source = 'Manuell aktualisiert';
    }
    if (body.monthly_savings_cents !== undefined) patch.monthly_savings_cents = Number(body.monthly_savings_cents);
    if (body.contract_id !== undefined) {
      patch.contract_id = typeof body.contract_id === 'string' && body.contract_id.trim() ? body.contract_id.trim() : null;
    }

    const updated = updateInvestment(req.params.id, patch);
    res.json({ investment: updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Investment konnte nicht aktualisiert werden.' });
  }
});

app.delete('/api/investments/:id', (req, res) => {
  try {
    const removed = deleteInvestment(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Investment nicht gefunden.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Fehler beim Löschen.' });
  }
});

app.post('/api/investments/refresh', async (_req, res) => {
  try {
    const all = listInvestments();
    const updatedList = [];
    const errors: string[] = [];

    for (const inv of all) {
      try {
        const quote = await fetchMarketQuoteAndHistory(inv.symbol);
        const updated = updateInvestment(inv.id, {
          current_price_cents: quote.currentPriceCents,
          currency: quote.currency,
          history: quote.history.length >= 2 ? quote.history : inv.history,
          price_source: quote.priceSource,
          last_updated: new Date().toISOString(),
        });
        if (updated) updatedList.push(updated);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `${inv.symbol}: Abruffehler`);
        updatedList.push(inv);
      }
    }

    if (errors.length === all.length && all.length > 0) {
      res.status(502).json({
        error: errors[0],
        investments: updatedList,
      });
      return;
    }

    res.json({
      investments: updatedList,
      warnings: errors,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Kursaktualisierung fehlgeschlagen.' });
  }
});

app.post('/api/ai/analyze', memoryUpload.single('file'), async (req, res) => {
  try {
    const categories = listCategories();
    const rawText = typeof req.body?.rawText === 'string' ? req.body.rawText : undefined;

    if (!req.file && !rawText?.trim()) {
      res.status(400).json({ error: 'Bitte laden Sie eine Datei hoch oder fügen Sie Text zur Analyse ein.' });
      return;
    }

    const result = await analyzeDocumentWithGemini({
      fileBuffer: req.file?.buffer,
      mimeType: req.file?.mimetype,
      fileName: req.file?.originalname,
      rawText,
      categories,
    });

    res.json({ extraction: result });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'KI-Analyse fehlgeschlagen.' });
  }
});

app.post('/api/documents/:id/summarize', async (req, res) => {
  try {
    const doc = getDocumentById(req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Dokument nicht gefunden.' });
      return;
    }
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    const summary = await summarizeDocumentWithGemini(doc, query);

    if (!query) {
      updateDocument(doc.id, { ai_summary: summary });
    }

    res.json({ summary, querySpecific: Boolean(query) });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Zusammenfassung konnte nicht erstellt werden.' });
  }
});

async function startServer(): Promise<void> {
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Archive Server läuft auf http://0.0.0.0:${PORT}`);
  });
}

startServer();
