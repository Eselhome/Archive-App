import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CategoryRecord,
  DocumentInput,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
  InvestmentInput,
  InvestmentRecord,
  LineItem,
  PricePoint,
} from '../src/types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'belege.db');

let dbInstance: Database.Database | null = null;

function ensureDirs(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function generateSampleHistory(startPriceCents: number, endPriceCents: number, points = 26): PricePoint[] {
  const result: PricePoint[] = [];
  const today = new Date('2026-11-17T00:00:00Z');
  for (let i = points - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i * 7);
    const t = (points - 1 - i) / (points - 1);
    const wave = Math.sin(t * Math.PI * 3.2) * 0.022 + Math.cos(t * Math.PI * 5.1) * 0.011;
    const interpolated = startPriceCents + (endPriceCents - startPriceCents) * t;
    const priceCents = Math.max(100, Math.round(interpolated * (1 + (i === 0 ? 0 : wave))));
    result.push({
      date: d.toISOString().slice(0, 10),
      priceCents,
    });
  }
  return result;
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  ensureDirs();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const currentVersion = (db.pragma('user_version', { simple: true }) as number) || 0;

  if (currentVersion < 2) {
    // Upgrade cleanly from v1 (initial receipt ledger) to v2 (Archive + Contracts + Investments)
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE IF EXISTS investments;
      DROP TABLE IF EXISTS documents;
      DROP TABLE IF EXISTS categories;
    `);
    db.pragma('foreign_keys = ON');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      accent TEXT NOT NULL DEFAULT '#A3A3A3',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      doc_type TEXT NOT NULL CHECK (doc_type IN ('Kaufbeleg', 'Vertrag', 'Monatsbeleg', 'Zeugnis', 'Sonstiges')),
      vendor TEXT NOT NULL,
      doc_number TEXT NOT NULL DEFAULT '',
      doc_date TEXT NOT NULL,
      amount_cents INTEGER,
      tax_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'EUR',
      category_id TEXT NOT NULL,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'Archiviert' CHECK (status IN ('Archiviert', 'Aktiv', 'Offen', 'Prüfung')),
      summary TEXT NOT NULL DEFAULT '',
      ai_summary TEXT NOT NULL DEFAULT '',
      extracted_text TEXT NOT NULL DEFAULT '',
      line_items_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      file_path TEXT,
      file_name TEXT,
      file_mime TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
      FOREIGN KEY (parent_id) REFERENCES documents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS investments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      isin TEXT NOT NULL DEFAULT '',
      asset_type TEXT NOT NULL DEFAULT 'ETF' CHECK (asset_type IN ('ETF', 'Aktie', 'Fonds', 'Anleihe')),
      contract_id TEXT,
      shares REAL NOT NULL DEFAULT 0,
      avg_buy_price_cents INTEGER NOT NULL DEFAULT 0,
      current_price_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      monthly_savings_cents INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL,
      price_source TEXT NOT NULL DEFAULT 'Archiv-Referenzkurs',
      history_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (contract_id) REFERENCES documents(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(doc_date DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category_id);
    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(doc_type);
    CREATE INDEX IF NOT EXISTS idx_documents_parent ON documents(parent_id);
  `);

  if (currentVersion < 2) {
    seedInitialData(db);
    db.pragma('user_version = 2');
  } else {
    seedInitialData(db);
  }

  dbInstance = db;
  return db;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function seedInitialData(db: Database.Database): void {
  const catCount = (db.prepare('SELECT COUNT(*) as cnt FROM categories').get() as { cnt: number }).cnt;
  if (catCount === 0) {
    const defaultCategories = [
      { id: 'cat-purchases', name: 'Online-Käufe', slug: 'online-kaeufe', accent: '#E5E5E5', sort_order: 1 },
      { id: 'cat-contracts', name: 'Verträge', slug: 'vertraege', accent: '#B5B5B5', sort_order: 2 },
      { id: 'cat-investments', name: 'Investments & Depots', slug: 'investments-depots', accent: '#D4D4D4', sort_order: 3 },
      { id: 'cat-certificates', name: 'Zeugnisse & Urkunden', slug: 'zeugnisse-urkunden', accent: '#8C8C8C', sort_order: 4 },
      { id: 'cat-housing', name: 'Wohnen & Energie', slug: 'wohnen-energie', accent: '#6B6B6B', sort_order: 5 },
      { id: 'cat-other', name: 'Sonstiges', slug: 'sonstiges', accent: '#525252', sort_order: 6 },
    ];

    const insertCat = db.prepare(
      'INSERT INTO categories (id, name, slug, accent, sort_order) VALUES (@id, @name, @slug, @accent, @sort_order)',
    );
    const tx = db.transaction(() => {
      for (const c of defaultCategories) insertCat.run(c);
    });
    tx();
  } else {
    db.prepare(`UPDATE categories SET accent = '#E5E5E5' WHERE accent = '#38BDF8'`).run();
    db.prepare(`UPDATE categories SET accent = '#B5B5B5' WHERE accent = '#818CF8'`).run();
    db.prepare(`UPDATE categories SET accent = '#D4D4D4' WHERE accent = '#34D399'`).run();
    db.prepare(`UPDATE categories SET accent = '#8C8C8C' WHERE accent = '#FBBF24'`).run();
    db.prepare(`UPDATE categories SET accent = '#6B6B6B' WHERE accent = '#FB923C'`).run();
    db.prepare(`UPDATE categories SET accent = '#525252' WHERE accent = '#94A3B8'`).run();
  }

  const docCount = (db.prepare('SELECT COUNT(*) as cnt FROM documents').get() as { cnt: number }).cnt;
  if (docCount === 0) {
    const now = new Date().toISOString();
    const seededDocs = [
      {
        id: 'doc-contract-depot',
        title: 'Wertpapierdepot & ETF-Sparplan Rahmenvertrag',
        doc_type: 'Vertrag',
        vendor: 'Scalable Capital Broker GmbH',
        doc_number: 'SC-DEP-4410',
        doc_date: '2025-01-15',
        amount_cents: null,
        tax_cents: null,
        currency: 'EUR',
        category_id: 'cat-investments',
        parent_id: null,
        status: 'Aktiv',
        summary:
          'Aktiver Depot- und Sparplanvertrag für monatliche ETF-Investments (iShares MSCI World, Vanguard FTSE All-World, EURO STOXX 50).',
        ai_summary:
          'Aktiver Depotvertrag SC-DEP-4410 bei Scalable Capital / Baader Bank vom 15.01.2025. Umfasst drei automatische monatliche ETF-Sparpläne über insgesamt 600,00 € pro Monat ohne Ordergebühr im Prime-Modell.',
        extracted_text:
          'Scalable Capital Broker GmbH Depotvertrag SC-DEP-4410 Baader Bank AG Sparplan ETF MSCI World IE00B4L5Y983 FTSE All-World IE00BK5BQT80 EURO STOXX 50 IE00B53L3W79 monatliche Ausführung zum 01. des Monats',
        line_items_json: JSON.stringify([
          { description: 'Monatlicher Sparplan MSCI World (EUNL.DE)', totalCents: 30000 },
          { description: 'Monatlicher Sparplan FTSE All-World (VWCE.DE)', totalCents: 20000 },
          { description: 'Monatlicher Sparplan EURO STOXX 50 (EUN2.DE)', totalCents: 10000 },
        ]),
        tags_json: JSON.stringify(['Depot', 'ETF-Sparplan', 'Langfristig']),
        file_path: null,
        file_name: null,
        file_mime: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'doc-monthly-depot-10',
        title: 'Monatlicher Depotauszug & Sparplanabrechnung Okt 2026',
        doc_type: 'Monatsbeleg',
        vendor: 'Scalable Capital Broker GmbH',
        doc_number: 'SC-2026-10',
        doc_date: '2026-11-01',
        amount_cents: 60000,
        tax_cents: 0,
        currency: 'EUR',
        category_id: 'cat-investments',
        parent_id: 'doc-contract-depot',
        status: 'Archiviert',
        summary:
          'Monatliche Sparplanausführung Oktober 2026 über 600,00 € für alle drei hinterlegten ETF-Positionen.',
        ai_summary:
          'Monatsabrechnung SC-2026-10 zum Depotvertrag SC-DEP-4410: Am 01.11.2026 wurden 300,00 € in iShares MSCI World, 200,00 € in Vanguard FTSE All-World und 100,00 € in EURO STOXX 50 investiert.',
        extracted_text:
          'Depotauszug Oktober 2026 SC-2026-10 Ausführung Sparplan IE00B4L5Y983 300,00 EUR IE00BK5BQT80 200,00 EUR IE00B53L3W79 100,00 EUR Summe 600,00 EUR',
        line_items_json: JSON.stringify([
          { description: 'Ausführung iShares MSCI World (EUNL.DE)', totalCents: 30000 },
          { description: 'Ausführung Vanguard FTSE All-World (VWCE.DE)', totalCents: 20000 },
          { description: 'Ausführung EURO STOXX 50 (EUN2.DE)', totalCents: 10000 },
        ]),
        tags_json: JSON.stringify(['Depotauszug', 'Oktober 2026', 'ETF']),
        file_path: null,
        file_name: null,
        file_mime: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'doc-monthly-depot-09',
        title: 'Monatlicher Depotauszug & Sparplanabrechnung Sep 2026',
        doc_type: 'Monatsbeleg',
        vendor: 'Scalable Capital Broker GmbH',
        doc_number: 'SC-2026-09',
        doc_date: '2026-10-01',
        amount_cents: 60000,
        tax_cents: 0,
        currency: 'EUR',
        category_id: 'cat-investments',
        parent_id: 'doc-contract-depot',
        status: 'Archiviert',
        summary:
          'Monatliche Sparplanausführung September 2026 über 600,00 € inkl. Quartals-Ertragsmitteilung.',
        ai_summary:
          'Monatsbeleg SC-2026-09 zum Depotvertrag: Planmäßige Einzahlung von 600,00 € in MSCI World, FTSE All-World und EURO STOXX 50.',
        extracted_text:
          'Depotauszug September 2026 SC-2026-09 Sparplanausführung 600,00 EUR Ausschüttungsgleiche Erträge 0,00 EUR',
        line_items_json: JSON.stringify([
          { description: 'Sparplan-Gesamtausführung September', totalCents: 60000 },
        ]),
        tags_json: JSON.stringify(['Depotauszug', 'September 2026']),
        file_path: null,
        file_name: null,
        file_mime: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'doc-purchase-apple',
        title: 'MacBook Pro 14" M4 Online-Kaufbeleg (PDF)',
        doc_type: 'Kaufbeleg',
        vendor: 'Apple Distribution International',
        doc_number: 'W94827104',
        doc_date: '2026-10-18',
        amount_cents: 239900,
        tax_cents: 38303,
        currency: 'EUR',
        category_id: 'cat-purchases',
        parent_id: null,
        status: 'Archiviert',
        summary:
          'Online-Kaufbeleg für MacBook Pro 14 Zoll M4 (24 GB RAM, 1 TB SSD) inklusive 24 Monate Gewährleistung und Seriennummer.',
        ai_summary:
          'Kaufbeleg W94827104 vom 18.10.2026 über 2.399,00 € brutto (2.015,97 € netto + 383,03 € MwSt.) für ein MacBook Pro 14" M4 Space Black. Enthält Seriennummer C02Z9182Q05N für Garantiefälle.',
        extracted_text:
          'Apple Store Online Rechnung W94827104 MacBook Pro 14 Zoll M4 24GB 1TB SSD Space Black Seriennummer C02Z9182Q05N Gesamtpreis 2.399,00 EUR inkl. 19% MwSt. 383,03 EUR Garantie bis 18.10.2028',
        line_items_json: JSON.stringify([
          { description: 'MacBook Pro 14" M4 (24 GB / 1 TB SSD)', totalCents: 239900 },
        ]),
        tags_json: JSON.stringify(['Elektronik', 'Garantie', 'Online-Kauf']),
        file_path: '/src/assets/images/sample_invoice_it_1794930847490.jpg',
        file_name: 'Apple_Kaufbeleg_W94827104.jpg',
        file_mime: 'image/jpeg',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'doc-purchase-office',
        title: 'Büro-Ausstattung & Schreibwaren Online-Bestellung',
        doc_type: 'Kaufbeleg',
        vendor: 'Office Supplies Direct',
        doc_number: '894567',
        doc_date: '2026-10-24',
        amount_cents: 5669,
        tax_cents: 1060,
        currency: 'EUR',
        category_id: 'cat-purchases',
        parent_id: null,
        status: 'Archiviert',
        summary:
          'Kaufbeleg für A4-Notizbücher, Gelschreiber, Schwerlast-Hefter, Haftnotizen, Klebeband und Whiteboard-Marker.',
        ai_summary:
          'Kaufbeleg Nr. 894567 von Office Supplies Direct vom 24.10.2026 über 56,69 € brutto (46,09 € netto + 10,60 € MwSt.) für 8 Schreibwaren-Positionen.',
        extracted_text:
          'OFFICE SUPPLIES DIRECT Receipt No: 894567 A4 NOTEBOOK 10.50 GEL PEN BLACK 2.50 STAPLER HD 8.99 POST-IT NOTES 4.75 SCOTCH TAPE 5.10 WHITEBOARD MARKERS 6.20 BINDER CLIPS 4.90 SCISSORS 3.15 TOTAL EUR 56.69',
        line_items_json: JSON.stringify([
          { description: '3x A4 Notizbuch & 2x Gel-Stifte', totalCents: 1300 },
          { description: 'Schwerlast-Hefter & Haftnotizen', totalCents: 1374 },
          { description: 'Marker, Clips, Klebeband & Schere', totalCents: 1935 },
        ]),
        tags_json: JSON.stringify(['Büro', 'Schreibwaren']),
        file_path: '/src/assets/images/sample_receipt_thermal_1794930847497.jpg',
        file_name: 'Kaufbeleg_Office_Supplies_894567.jpg',
        file_mime: 'image/jpeg',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'doc-contract-rent',
        title: 'Wohnungs-Mietvertrag Berliner Allee 42',
        doc_type: 'Vertrag',
        vendor: 'Hausverwaltung Lindner GmbH',
        doc_number: 'MV-2023-104',
        doc_date: '2023-04-01',
        amount_cents: 124000,
        tax_cents: 0,
        currency: 'EUR',
        category_id: 'cat-housing',
        parent_id: null,
        status: 'Aktiv',
        summary:
          'Unbefristeter Wohnraummietvertrag (3 Zimmer, 82 m²) mit 1.020,00 € Kaltmiete und 220,00 € Nebenkosten-Vorauszahlung.',
        ai_summary:
          'Mietvertrag MV-2023-104 vom 01.04.2023 mit Hausverwaltung Lindner GmbH über 1.240,00 € Warmmiete monatlich (1.020 € kalt + 220 € Betriebskosten), Kaution 3.060,00 €, gesetzliche Kündigungsfrist 3 Monate.',
        extracted_text:
          'Mietvertrag MV-2023-104 Berliner Allee 42 10117 Berlin 3 Zimmer 82 qm Kaltmiete 1.020,00 EUR Betriebskosten-Vorauszahlung 220,00 EUR Gesamtmiete 1.240,00 EUR Kaution 3.060,00 EUR',
        line_items_json: JSON.stringify([
          { description: 'Nettokaltmiete monatlich', totalCents: 102000 },
          { description: 'Betriebs- & Heizkostenvorauszahlung', totalCents: 22000 },
        ]),
        tags_json: JSON.stringify(['Mietvertrag', 'Wohnung', 'Unbefristet']),
        file_path: null,
        file_name: null,
        file_mime: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'doc-monthly-rent-11',
        title: 'Nebenkosten- & Heizkostenabrechnung 2025/2026',
        doc_type: 'Monatsbeleg',
        vendor: 'Hausverwaltung Lindner GmbH',
        doc_number: 'NK-2026-42',
        doc_date: '2026-11-04',
        amount_cents: 18540,
        tax_cents: 0,
        currency: 'EUR',
        category_id: 'cat-housing',
        parent_id: 'doc-contract-rent',
        status: 'Offen',
        summary:
          'Jährliche Betriebskostenabrechnung zum Mietvertrag Berliner Allee mit einer offenen Nachzahlung von 185,40 €.',
        ai_summary:
          'Abrechnung NK-2026-42 zum Mietvertrag MV-2023-104: Gesamtkosten 2.825,40 € abzüglich Vorauszahlungen 2.640,00 € ergibt eine offene Nachzahlung von 185,40 € (fällig bis 30.11.2026).',
        extracted_text:
          'Betriebskostenabrechnung NK-2026-42 Berliner Allee 42 Heizung Warmwasser Grundsteuer Müllabfuhr Vorauszahlungen 2.640,00 EUR Gesamtkosten 2.825,40 EUR Nachzahlung 185,40 EUR',
        line_items_json: JSON.stringify([
          { description: 'Nachzahlung Heizung & Betriebskosten', totalCents: 18540 },
        ]),
        tags_json: JSON.stringify(['Nebenkosten', 'Frist 30.11.']),
        file_path: null,
        file_name: null,
        file_mime: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'doc-cert-work',
        title: 'Qualifiziertes Arbeitszeugnis Senior Software Engineer',
        doc_type: 'Zeugnis',
        vendor: 'Nordlicht Systems GmbH',
        doc_number: 'AZ-2024-09',
        doc_date: '2024-09-30',
        amount_cents: null,
        tax_cents: null,
        currency: 'EUR',
        category_id: 'cat-certificates',
        parent_id: null,
        status: 'Archiviert',
        summary:
          'Qualifiziertes Arbeitszeugnis über Tätigkeit als Senior Software Engineer (2021–2024) mit Bestnote.',
        ai_summary:
          'Arbeitszeugnis AZ-2024-09 der Nordlicht Systems GmbH vom 30.09.2024. Bescheinigt herausragende Leistungen in TypeScript, Cloud-Architektur und Teamführung („stets zu unserer vollsten Zufriedenheit“).',
        extracted_text:
          'Arbeitszeugnis Nordlicht Systems GmbH Zeitraum 01.03.2021 bis 30.09.2024 Senior Software Engineer TypeScript React Node.js Kubernetes Bewertung stets zu unserer vollsten Zufriedenheit',
        line_items_json: '[]',
        tags_json: JSON.stringify(['Arbeitszeugnis', 'Karriere', 'Bewerbung']),
        file_path: null,
        file_name: null,
        file_mime: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'doc-cert-uni',
        title: 'Master of Science Urkunde & Notenspiegel Informatik',
        doc_type: 'Zeugnis',
        vendor: 'Technische Universität Berlin',
        doc_number: 'TUB-MSC-8821',
        doc_date: '2021-02-15',
        amount_cents: null,
        tax_cents: null,
        currency: 'EUR',
        category_id: 'cat-certificates',
        parent_id: null,
        status: 'Archiviert',
        summary:
          'Beglaubigte Abschlussurkunde und Transcript of Records (M.Sc. Informatik, Gesamtnote 1,3).',
        ai_summary:
          'Master-Urkunde TUB-MSC-8821 der TU Berlin vom 15.02.2021 im Studiengang Informatik mit Gesamtnote 1,3 („sehr gut“) und Schwerpunkt Verteilte Systeme.',
        extracted_text:
          'Technische Universität Berlin Master of Science Informatik Verteilte Systeme Gesamtnote 1,3 sehr gut Urkunde Nr. TUB-MSC-8821',
        line_items_json: '[]',
        tags_json: JSON.stringify(['Studium', 'Master', 'Urkunde']),
        file_path: null,
        file_name: null,
        file_mime: null,
        created_at: now,
        updated_at: now,
      },
    ];

    const insertDoc = db.prepare(`
      INSERT INTO documents (
        id, title, doc_type, vendor, doc_number, doc_date,
        amount_cents, tax_cents, currency, category_id, parent_id, status,
        summary, ai_summary, extracted_text, line_items_json, tags_json,
        file_path, file_name, file_mime, created_at, updated_at
      ) VALUES (
        @id, @title, @doc_type, @vendor, @doc_number, @doc_date,
        @amount_cents, @tax_cents, @currency, @category_id, @parent_id, @status,
        @summary, @ai_summary, @extracted_text, @line_items_json, @tags_json,
        @file_path, @file_name, @file_mime, @created_at, @updated_at
      )
    `);
    const tx = db.transaction(() => {
      for (const doc of seededDocs) insertDoc.run(doc);
    });
    tx();
  }

  const invCount = (db.prepare('SELECT COUNT(*) as cnt FROM investments').get() as { cnt: number }).cnt;
  if (invCount === 0) {
    const now = new Date().toISOString();
    const seededInvestments = [
      {
        id: 'inv-msci-world',
        name: 'iShares Core MSCI World UCITS ETF',
        symbol: 'EUNL.DE',
        isin: 'IE00B4L5Y983',
        asset_type: 'ETF',
        contract_id: 'doc-contract-depot',
        shares: 64.5,
        avg_buy_price_cents: 8840,
        current_price_cents: 10385,
        currency: 'EUR',
        monthly_savings_cents: 30000,
        last_updated: now,
        price_source: 'Archiv-Referenzkurs',
        history_json: JSON.stringify(generateSampleHistory(9120, 10385)),
      },
      {
        id: 'inv-ftse-allworld',
        name: 'Vanguard FTSE All-World UCITS ETF',
        symbol: 'VWCE.DE',
        isin: 'IE00BK5BQT80',
        asset_type: 'ETF',
        contract_id: 'doc-contract-depot',
        shares: 42.0,
        avg_buy_price_cents: 11420,
        current_price_cents: 13140,
        currency: 'EUR',
        monthly_savings_cents: 20000,
        last_updated: now,
        price_source: 'Archiv-Referenzkurs',
        history_json: JSON.stringify(generateSampleHistory(11780, 13140)),
      },
      {
        id: 'inv-eurostoxx50',
        name: 'iShares Core EURO STOXX 50 ETF',
        symbol: 'EUN2.DE',
        isin: 'IE00B53L3W79',
        asset_type: 'ETF',
        contract_id: 'doc-contract-depot',
        shares: 18.0,
        avg_buy_price_cents: 4750,
        current_price_cents: 5120,
        currency: 'EUR',
        monthly_savings_cents: 10000,
        last_updated: now,
        price_source: 'Archiv-Referenzkurs',
        history_json: JSON.stringify(generateSampleHistory(4690, 5120)),
      },
    ];

    const insertInv = db.prepare(`
      INSERT INTO investments (
        id, name, symbol, isin, asset_type, contract_id,
        shares, avg_buy_price_cents, current_price_cents, currency,
        monthly_savings_cents, last_updated, price_source, history_json
      ) VALUES (
        @id, @name, @symbol, @isin, @asset_type, @contract_id,
        @shares, @avg_buy_price_cents, @current_price_cents, @currency,
        @monthly_savings_cents, @last_updated, @price_source, @history_json
      )
    `);
    const tx = db.transaction(() => {
      for (const inv of seededInvestments) insertInv.run(inv);
    });
    tx();
  }
}

interface RawDocumentRow {
  id: string;
  title: string;
  doc_type: DocumentType;
  vendor: string;
  doc_number: string;
  doc_date: string;
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
  line_items_json: string;
  tags_json: string;
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  created_at: string;
  updated_at: string;
}

function mapDocumentRow(row: RawDocumentRow): DocumentRecord {
  let lineItems: LineItem[] = [];
  let tags: string[] = [];
  try {
    lineItems = JSON.parse(row.line_items_json || '[]') as LineItem[];
  } catch {
    lineItems = [];
  }
  try {
    tags = JSON.parse(row.tags_json || '[]') as string[];
  } catch {
    tags = [];
  }

  let fileUrl: string | null = null;
  if (row.file_path) {
    fileUrl = row.file_path.startsWith('/src/assets/')
      ? row.file_path
      : `/api/documents/${row.id}/file`;
  }

  return {
    id: row.id,
    title: row.title,
    doc_type: row.doc_type,
    vendor: row.vendor,
    doc_number: row.doc_number,
    doc_date: row.doc_date,
    amount_cents: row.amount_cents,
    tax_cents: row.tax_cents,
    currency: row.currency,
    category_id: row.category_id,
    category_name: row.category_name,
    parent_id: row.parent_id,
    parent_title: row.parent_title ?? null,
    status: row.status,
    summary: row.summary,
    ai_summary: row.ai_summary,
    extracted_text: row.extracted_text,
    line_items: lineItems,
    tags,
    file_url: fileUrl,
    file_name: row.file_name,
    file_mime: row.file_mime,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listCategories(): CategoryRecord[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.accent, c.sort_order, COUNT(d.id) as document_count
       FROM categories c
       LEFT JOIN documents d ON d.category_id = c.id
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC`,
    )
    .all() as CategoryRecord[];
}

export function createCategory(name: string, accent = '#38BDF8'): CategoryRecord {
  const db = getDb();
  const cleanName = name.trim();
  const slug = slugify(cleanName) || `cat-${Date.now()}`;
  const id = `cat-${crypto.randomUUID().slice(0, 8)}`;
  const maxOrderRow = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as maxOrder FROM categories').get() as {
    maxOrder: number;
  };
  const sortOrder = (maxOrderRow?.maxOrder ?? 0) + 1;
  db.prepare('INSERT INTO categories (id, name, slug, accent, sort_order) VALUES (?, ?, ?, ?, ?)').run(
    id,
    cleanName,
    slug,
    accent,
    sortOrder,
  );
  return { id, name: cleanName, slug, accent, sort_order: sortOrder, document_count: 0 };
}

export function deleteCategory(id: string): { deleted: boolean; reason?: string } {
  const db = getDb();
  const usage = db.prepare('SELECT COUNT(*) as cnt FROM documents WHERE category_id = ?').get(id) as { cnt: number };
  if (usage.cnt > 0) {
    return {
      deleted: false,
      reason: `Diese Kategorie wird noch von ${usage.cnt} Dokument(en) verwendet.`,
    };
  }
  const res = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return { deleted: res.changes > 0 };
}

export function listDocuments(): DocumentRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT d.*, c.name as category_name, p.title as parent_title
       FROM documents d
       LEFT JOIN categories c ON c.id = d.category_id
       LEFT JOIN documents p ON p.id = d.parent_id
       ORDER BY d.doc_date DESC, d.created_at DESC`,
    )
    .all() as RawDocumentRow[];
  return rows.map(mapDocumentRow);
}

export function getDocumentById(id: string): DocumentRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT d.*, c.name as category_name, p.title as parent_title
       FROM documents d
       LEFT JOIN categories c ON c.id = d.category_id
       LEFT JOIN documents p ON p.id = d.parent_id
       WHERE d.id = ?`,
    )
    .get(id) as RawDocumentRow | undefined;
  return row ? mapDocumentRow(row) : null;
}

export function getDocumentFileMeta(id: string): { file_path: string; file_name: string | null; file_mime: string | null } | null {
  const db = getDb();
  const row = db
    .prepare('SELECT file_path, file_name, file_mime FROM documents WHERE id = ?')
    .get(id) as { file_path: string | null; file_name: string | null; file_mime: string | null } | undefined;
  if (!row || !row.file_path) return null;
  return { file_path: row.file_path, file_name: row.file_name, file_mime: row.file_mime };
}

export function createDocument(
  input: DocumentInput,
  fileMeta?: { filePath: string; fileName: string; fileMime: string } | null,
): DocumentRecord {
  const db = getDb();
  const id = `doc-${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO documents (
      id, title, doc_type, vendor, doc_number, doc_date,
      amount_cents, tax_cents, currency, category_id, parent_id, status,
      summary, ai_summary, extracted_text, line_items_json, tags_json,
      file_path, file_name, file_mime, created_at, updated_at
    ) VALUES (
      @id, @title, @doc_type, @vendor, @doc_number, @doc_date,
      @amount_cents, @tax_cents, @currency, @category_id, @parent_id, @status,
      @summary, @ai_summary, @extracted_text, @line_items_json, @tags_json,
      @file_path, @file_name, @file_mime, @created_at, @updated_at
    )`,
  ).run({
    id,
    title: input.title.trim(),
    doc_type: input.doc_type,
    vendor: input.vendor.trim(),
    doc_number: (input.doc_number ?? '').trim(),
    doc_date: input.doc_date,
    amount_cents: input.amount_cents !== null && input.amount_cents !== undefined ? Math.round(input.amount_cents) : null,
    tax_cents: input.tax_cents !== null && input.tax_cents !== undefined ? Math.round(input.tax_cents) : null,
    currency: input.currency || 'EUR',
    category_id: input.category_id,
    parent_id: input.parent_id ? input.parent_id : null,
    status: input.status || 'Archiviert',
    summary: (input.summary ?? '').trim(),
    ai_summary: (input.ai_summary ?? '').trim(),
    extracted_text: (input.extracted_text ?? '').trim(),
    line_items_json: JSON.stringify(input.line_items ?? []),
    tags_json: JSON.stringify(input.tags ?? []),
    file_path: fileMeta?.filePath ?? null,
    file_name: fileMeta?.fileName ?? null,
    file_mime: fileMeta?.fileMime ?? null,
    created_at: now,
    updated_at: now,
  });

  const created = getDocumentById(id);
  if (!created) {
    throw new Error('Dokument konnte nach dem Speichern nicht geladen werden.');
  }
  return created;
}

export function updateDocument(id: string, patch: Partial<DocumentInput>): DocumentRecord | null {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE documents SET
      title = @title,
      doc_type = @doc_type,
      vendor = @vendor,
      doc_number = @doc_number,
      doc_date = @doc_date,
      amount_cents = @amount_cents,
      tax_cents = @tax_cents,
      currency = @currency,
      category_id = @category_id,
      parent_id = @parent_id,
      status = @status,
      summary = @summary,
      ai_summary = @ai_summary,
      extracted_text = @extracted_text,
      line_items_json = @line_items_json,
      tags_json = @tags_json,
      updated_at = @updated_at
    WHERE id = @id`,
  ).run({
    id,
    title: patch.title !== undefined ? patch.title.trim() : existing.title,
    doc_type: patch.doc_type ?? existing.doc_type,
    vendor: patch.vendor !== undefined ? patch.vendor.trim() : existing.vendor,
    doc_number: patch.doc_number !== undefined ? patch.doc_number.trim() : existing.doc_number,
    doc_date: patch.doc_date ?? existing.doc_date,
    amount_cents:
      patch.amount_cents !== undefined
        ? patch.amount_cents === null
          ? null
          : Math.round(patch.amount_cents)
        : existing.amount_cents,
    tax_cents:
      patch.tax_cents !== undefined
        ? patch.tax_cents === null
          ? null
          : Math.round(patch.tax_cents)
        : existing.tax_cents,
    currency: patch.currency ?? existing.currency,
    category_id: patch.category_id ?? existing.category_id,
    parent_id: patch.parent_id !== undefined ? patch.parent_id : existing.parent_id,
    status: patch.status ?? existing.status,
    summary: patch.summary !== undefined ? patch.summary.trim() : existing.summary,
    ai_summary: patch.ai_summary !== undefined ? patch.ai_summary.trim() : existing.ai_summary,
    extracted_text: patch.extracted_text !== undefined ? patch.extracted_text.trim() : existing.extracted_text,
    line_items_json:
      patch.line_items !== undefined ? JSON.stringify(patch.line_items) : JSON.stringify(existing.line_items),
    tags_json: patch.tags !== undefined ? JSON.stringify(patch.tags) : JSON.stringify(existing.tags),
    updated_at: now,
  });

  return getDocumentById(id);
}

export function deleteDocument(id: string): boolean {
  const db = getDb();
  const meta = getDocumentFileMeta(id);
  const res = db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  if (res.changes > 0 && meta?.file_path && !meta.file_path.startsWith('/src/assets/')) {
    const absPath = path.join(UPLOADS_DIR, path.basename(meta.file_path));
    if (fs.existsSync(absPath)) {
      try {
        fs.unlinkSync(absPath);
      } catch {
        // Ignore cleanup failure
      }
    }
  }
  return res.changes > 0;
}

interface RawInvestmentRow {
  id: string;
  name: string;
  symbol: string;
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
  history_json: string;
}

function mapInvestmentRow(row: RawInvestmentRow): InvestmentRecord {
  let history: PricePoint[] = [];
  try {
    history = JSON.parse(row.history_json || '[]') as PricePoint[];
  } catch {
    history = [];
  }
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    isin: row.isin,
    asset_type: row.asset_type,
    contract_id: row.contract_id,
    contract_title: row.contract_title ?? null,
    shares: row.shares,
    avg_buy_price_cents: row.avg_buy_price_cents,
    current_price_cents: row.current_price_cents,
    currency: row.currency,
    monthly_savings_cents: row.monthly_savings_cents,
    last_updated: row.last_updated,
    price_source: row.price_source,
    history,
  };
}

export function listInvestments(): InvestmentRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT i.*, d.title as contract_title
       FROM investments i
       LEFT JOIN documents d ON d.id = i.contract_id
       ORDER BY (i.shares * i.current_price_cents) DESC`,
    )
    .all() as RawInvestmentRow[];
  return rows.map(mapInvestmentRow);
}

export function getInvestmentById(id: string): InvestmentRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT i.*, d.title as contract_title
       FROM investments i
       LEFT JOIN documents d ON d.id = i.contract_id
       WHERE i.id = ?`,
    )
    .get(id) as RawInvestmentRow | undefined;
  return row ? mapInvestmentRow(row) : null;
}

export function createInvestment(input: InvestmentInput): InvestmentRecord {
  const db = getDb();
  const id = `inv-${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  const history = generateSampleHistory(
    Math.round(input.avg_buy_price_cents * 0.96),
    input.current_price_cents || input.avg_buy_price_cents,
  );

  db.prepare(
    `INSERT INTO investments (
      id, name, symbol, isin, asset_type, contract_id,
      shares, avg_buy_price_cents, current_price_cents, currency,
      monthly_savings_cents, last_updated, price_source, history_json
    ) VALUES (
      @id, @name, @symbol, @isin, @asset_type, @contract_id,
      @shares, @avg_buy_price_cents, @current_price_cents, @currency,
      @monthly_savings_cents, @last_updated, @price_source, @history_json
    )`,
  ).run({
    id,
    name: input.name.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    isin: input.isin.trim().toUpperCase(),
    asset_type: input.asset_type,
    contract_id: input.contract_id || null,
    shares: Number(input.shares) || 0,
    avg_buy_price_cents: Math.round(input.avg_buy_price_cents || 0),
    current_price_cents: Math.round(input.current_price_cents || input.avg_buy_price_cents || 0),
    currency: input.currency || 'EUR',
    monthly_savings_cents: Math.round(input.monthly_savings_cents || 0),
    last_updated: now,
    price_source: 'Manuell erfasst',
    history_json: JSON.stringify(history),
  });

  const created = getInvestmentById(id);
  if (!created) throw new Error('Investment konnte nicht erstellt werden.');
  return created;
}

export function updateInvestment(
  id: string,
  patch: Partial<InvestmentInput> & { price_source?: string; history?: PricePoint[]; last_updated?: string },
): InvestmentRecord | null {
  const db = getDb();
  const existing = getInvestmentById(id);
  if (!existing) return null;

  const now = patch.last_updated || new Date().toISOString();
  db.prepare(
    `UPDATE investments SET
      name = @name,
      symbol = @symbol,
      isin = @isin,
      asset_type = @asset_type,
      contract_id = @contract_id,
      shares = @shares,
      avg_buy_price_cents = @avg_buy_price_cents,
      current_price_cents = @current_price_cents,
      currency = @currency,
      monthly_savings_cents = @monthly_savings_cents,
      last_updated = @last_updated,
      price_source = @price_source,
      history_json = @history_json
    WHERE id = @id`,
  ).run({
    id,
    name: patch.name !== undefined ? patch.name.trim() : existing.name,
    symbol: patch.symbol !== undefined ? patch.symbol.trim().toUpperCase() : existing.symbol,
    isin: patch.isin !== undefined ? patch.isin.trim().toUpperCase() : existing.isin,
    asset_type: patch.asset_type ?? existing.asset_type,
    contract_id: patch.contract_id !== undefined ? patch.contract_id : existing.contract_id,
    shares: patch.shares !== undefined ? Number(patch.shares) : existing.shares,
    avg_buy_price_cents:
      patch.avg_buy_price_cents !== undefined
        ? Math.round(patch.avg_buy_price_cents)
        : existing.avg_buy_price_cents,
    current_price_cents:
      patch.current_price_cents !== undefined
        ? Math.round(patch.current_price_cents)
        : existing.current_price_cents,
    currency: patch.currency ?? existing.currency,
    monthly_savings_cents:
      patch.monthly_savings_cents !== undefined
        ? Math.round(patch.monthly_savings_cents)
        : existing.monthly_savings_cents,
    last_updated: now,
    price_source: patch.price_source ?? existing.price_source,
    history_json: patch.history ? JSON.stringify(patch.history) : JSON.stringify(existing.history),
  });

  return getInvestmentById(id);
}

export function deleteInvestment(id: string): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM investments WHERE id = ?').run(id);
  return res.changes > 0;
}
