import { GoogleGenAI, Type } from '@google/genai';
import type {
  AiExtractionResult,
  CategoryRecord,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
} from '../src/types.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY ist auf dem Server nicht konfiguriert.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractReadableTextFromBuffer(
  fileBuffer?: Buffer,
  mimeType?: string,
  rawText?: string,
): string {
  if (rawText && rawText.trim()) {
    return rawText.trim().slice(0, 30000);
  }
  if (!fileBuffer) return '';

  if (mimeType?.startsWith('text/') || mimeType === 'application/json') {
    return fileBuffer.toString('utf8').replace(/\0/g, '').trim().slice(0, 30000);
  }

  if (mimeType === 'application/pdf') {
    const latin = fileBuffer.toString('latin1');
    const chunks: string[] = [];
    // Extract PDF text literals inside parentheses: (...) Tj / TJ
    const literalRegex = /\(([^()\\]{3,160})\)/g;
    let match: RegExpExecArray | null;
    while ((match = literalRegex.exec(latin)) !== null && chunks.length < 400) {
      const cleaned = match[1].replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 3 && /[a-zA-ZäöüÄÖÜß0-9]/.test(cleaned)) {
        chunks.push(cleaned);
      }
    }
    if (chunks.length > 0) {
      return chunks.join(' ').slice(0, 20000);
    }
  }

  return '';
}

function detectDateIso(text: string): string {
  const isoMatch = text.match(/\b(20\d{2}|19\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) return isoMatch[0];

  const deMatch = text.match(/\b(0?[1-9]|[12]\d|3[01])\.(0?[1-9]|1[0-2])\.(20\d{2}|19\d{2})\b/);
  if (deMatch) {
    const day = deMatch[1].padStart(2, '0');
    const month = deMatch[2].padStart(2, '0');
    const year = deMatch[3];
    return `${year}-${month}-${day}`;
  }

  return new Date().toISOString().slice(0, 10);
}

function detectDocType(combinedLower: string): DocumentType {
  if (/(zeugnis|urkunde|zertifikat|diplom|bachelor|master|abschluss|bescheinigung)/.test(combinedLower)) {
    return 'Zeugnis';
  }
  if (/(monats|depotauszug|sparplanausf|abrechnung|nebenkosten|heizkosten|gehalts|lohnabrechnung|kontoauszug)/.test(combinedLower)) {
    return 'Monatsbeleg';
  }
  if (/(vertrag|mietvertrag|rahmenvertrag|arbeitsvertrag|versicherung|police|kündigungsfrist|abonnement)/.test(combinedLower)) {
    return 'Vertrag';
  }
  if (/(kaufbeleg|rechnung|quittung|bestellung|bestellbestätigung|kassenbon|invoice|receipt|order)/.test(combinedLower)) {
    return 'Kaufbeleg';
  }
  return 'Sonstiges';
}

function detectCategoryName(docType: DocumentType, combinedLower: string, categories: CategoryRecord[]): string {
  const findByKeyword = (kw: string) =>
    categories.find((c) => c.name.toLowerCase().includes(kw))?.name;

  if (docType === 'Zeugnis') {
    return findByKeyword('zeugnis') || categories[0]?.name || 'Sonstiges';
  }
  if (/(etf|depot|sparplan|aktie|fonds|scalable|trade republic|consors|ing|isin|wkn)/.test(combinedLower)) {
    return findByKeyword('investment') || findByKeyword('depot') || categories[0]?.name || 'Sonstiges';
  }
  if (/(miete|wohnung|strom|gas|energie|nebenkosten|hausverwaltung|wasser|internet)/.test(combinedLower)) {
    return findByKeyword('wohnen') || findByKeyword('energie') || categories[0]?.name || 'Sonstiges';
  }
  if (docType === 'Vertrag') {
    return findByKeyword('vertrag') || findByKeyword('verträg') || categories[0]?.name || 'Sonstiges';
  }
  if (docType === 'Kaufbeleg') {
    return findByKeyword('kauf') || findByKeyword('online') || categories[0]?.name || 'Sonstiges';
  }
  return findByKeyword('sonstig') || categories[0]?.name || 'Sonstiges';
}

export function extractDocumentLocally(params: {
  fileBuffer?: Buffer;
  mimeType?: string;
  fileName?: string;
  rawText?: string;
  categories: CategoryRecord[];
}): AiExtractionResult {
  const extractedText = extractReadableTextFromBuffer(
    params.fileBuffer,
    params.mimeType,
    params.rawText,
  );
  const cleanFileName = (params.fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  const combined = `${cleanFileName}\n${extractedText}`.trim();
  const combinedLower = combined.toLowerCase();

  const docType = detectDocType(combinedLower);
  const docDate = detectDateIso(combined);

  // Detect order/contract/doc number
  const numMatch = combined.match(
    /(?:Rechnungsnr\.?|Bestellnr\.?|Vertragsnr\.?|Aktenzeichen|Nr\.?|Order(?:\s*ID)?|Invoice)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{3,24})/i,
  );
  const docNumber = numMatch ? numMatch[1].trim() : '';

  // Detect optional price when Kaufbeleg / Monatsbeleg
  let amountEur: number | null = null;
  if (docType === 'Kaufbeleg' || docType === 'Monatsbeleg') {
    const priceMatch = combined.match(/(?:Gesamt(?:betrag|summe)?|Summe|Total|Betrag)?\s*[:=]?\s*(\d{1,5}[.,]\d{2})\s*(?:€|EUR)/i);
    if (priceMatch) {
      const parsed = Number.parseFloat(priceMatch[1].replace(',', '.'));
      if (Number.isFinite(parsed) && parsed > 0) {
        amountEur = parsed;
      }
    }
  }

  // Extract vendor from first meaningful line or filename
  const lines = extractedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2 && l.length <= 80);

  const vendorFromLine = lines.find((l) => /(GmbH|AG|SE|Inc\.|Ltd\.|KG|e\.V\.|University|Universität|Verlag|Bank|Broker|Store)/i.test(l));
  const vendor =
    vendorFromLine ||
    (cleanFileName.split(/\s+/)[0] && cleanFileName.split(/\s+/)[0].length > 2
      ? cleanFileName.split(/\s+/).slice(0, 2).join(' ')
      : 'Archiv-Upload');

  const title = cleanFileName || (lines[0] ? lines[0].slice(0, 72) : `${docType} vom ${docDate}`);
  const status: DocumentStatus = docType === 'Vertrag' ? 'Aktiv' : 'Archiviert';
  const suggestedCategoryName = detectCategoryName(docType, combinedLower, params.categories);

  const previewText = extractedText
    ? extractedText.replace(/\s+/g, ' ').trim().slice(0, 210)
    : `Automatisch archiviertes Dokument (${docType}) aus Datei „${params.fileName || title}“.`;

  const summary =
    extractedText.length > 35
      ? `${docType} von ${vendor} (${docDate.split('-').reverse().join('.')}). ${previewText}${extractedText.length > 210 ? '…' : ''}`
      : `${docType} „${title}“ von ${vendor}, automatisch am ${docDate.split('-').reverse().join('.')} ins Archiv übernommen.`;

  const tags: string[] = [docType];
  if (/(etf|sparplan|isin|depot)/i.test(combined)) tags.push('ETF');
  if (/(garantie|gewährleistung)/i.test(combined)) tags.push('Garantie');
  if (/(steuer|bescheinigung)/i.test(combined)) tags.push('Unterlagen');

  return {
    title,
    doc_type: docType,
    vendor,
    doc_number: docNumber,
    doc_date: docDate,
    amount_eur: amountEur,
    tax_eur: null,
    suggested_category_name: suggestedCategoryName,
    status,
    summary,
    extracted_text: extractedText || cleanFileName,
    line_items: [],
    tags: Array.from(new Set(tags)).slice(0, 5),
  };
}

export async function analyzeDocumentWithGemini(params: {
  fileBuffer?: Buffer;
  mimeType?: string;
  fileName?: string;
  rawText?: string;
  categories: CategoryRecord[];
}): Promise<AiExtractionResult> {
  const ai = getGeminiClient();
  const categoryNames = params.categories.map((c) => c.name).join(', ');

  const promptText = `Analysiere dieses hochgeladene Dokument für ein persönliches Dokumentenarchiv ("Archive").
Mögliche Dokumenttypen:
- "Kaufbeleg" (Online-Käufe, PDF-Bestellbestätigungen, Rechnungen, Kassenbons)
- "Vertrag" (Mietverträge, Depot-/Sparplanverträge, Arbeitsverträge, Versicherungen)
- "Monatsbeleg" (monatliche Depotauszüge, Gehaltsabrechnungen, Nebenkosten-/Monatsrechnungen zu einem Vertrag)
- "Zeugnis" (Arbeitszeugnisse, Zertifikate, Abschlussurkunden)
- "Sonstiges"

Verfügbare Kategorien: ${categoryNames}.
Formatiere das Datum als JJJJ-MM-TT. Falls kein Datum erkennbar ist, nutze ${new Date().toISOString().slice(0, 10)}.
Falls ein Dokument keinen Geldpreis hat (z. B. Zeugnis oder Rahmenvertrag), gib null für amount_eur und tax_eur zurück.
Erstelle eine prägnante, sachliche Zusammenfassung des Inhalts in 2 bis 3 deutschen Sätzen für die Archiv-Vorschau.
Extrahiere außerdem den durchsuchbaren Volltext (Positionen, Vertragsnummern, ISINs, Seriennummern, Daten).
${params.fileName ? `Dateiname: ${params.fileName}` : ''}
${params.rawText ? `\nZusätzlicher Textinhalt:\n${params.rawText}` : ''}`;

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  if (params.fileBuffer && params.mimeType) {
    if (params.mimeType.startsWith('image/') || params.mimeType === 'application/pdf') {
      parts.push({
        inlineData: {
          mimeType: params.mimeType,
          data: params.fileBuffer.toString('base64'),
        },
      });
    } else if (params.mimeType.startsWith('text/') || params.mimeType === 'application/json') {
      parts.push({ text: `Dateiinhalt:\n${params.fileBuffer.toString('utf8').slice(0, 30000)}` });
    }
  }

  parts.push({ text: promptText });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction:
        'Du bist ein präziser deutscher Dokumenten-Archivar für Kaufbelege, Verträge, Monatsbelege und Zeugnisse. Antworte ausschließlich mit validem JSON gemäß Schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: 'Kurzer, eindeutiger Dokumenttitel auf Deutsch' },
          doc_type: {
            type: Type.STRING,
            description: 'Genau einer der Werte: Kaufbeleg, Vertrag, Monatsbeleg, Zeugnis, Sonstiges',
          },
          vendor: { type: Type.STRING, description: 'Shop, Vertragspartner, Arbeitgeber oder Institution' },
          doc_number: { type: Type.STRING, description: 'Bestell-, Vertrags- oder Aktennummer' },
          doc_date: { type: Type.STRING, description: 'Dokumentdatum im Format YYYY-MM-DD' },
          amount_eur: { type: Type.NUMBER, nullable: true, description: 'Betrag in Euro oder null falls ohne Preis' },
          tax_eur: { type: Type.NUMBER, nullable: true, description: 'Null oder optional MwSt.' },
          suggested_category_name: { type: Type.STRING, description: 'Passender Kategoriename aus den verfügbaren Kategorien' },
          status: {
            type: Type.STRING,
            description: 'Genau einer der Werte: Archiviert, Aktiv, Offen, Prüfung',
          },
          summary: { type: Type.STRING, description: 'Prägnante Inhaltszusammenfassung in 2-3 deutschen Sätzen' },
          extracted_text: { type: Type.STRING, description: 'Wichtiger Volltext aus dem Dokument für die Suche' },
          line_items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                quantity: { type: Type.STRING },
                total_eur: { type: Type.NUMBER },
              },
            },
          },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      },
    },
  });

  const rawJson = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawJson) as {
    title?: string;
    doc_type?: string;
    vendor?: string;
    doc_number?: string;
    doc_date?: string;
    amount_eur?: number | null;
    tax_eur?: number | null;
    suggested_category_name?: string;
    status?: string;
    summary?: string;
    extracted_text?: string;
    line_items?: Array<{ description?: string; quantity?: string; total_eur?: number }>;
    tags?: string[];
  };

  const validType =
    parsed.doc_type === 'Kaufbeleg' ||
    parsed.doc_type === 'Vertrag' ||
    parsed.doc_type === 'Monatsbeleg' ||
    parsed.doc_type === 'Zeugnis' ||
    parsed.doc_type === 'Sonstiges'
      ? parsed.doc_type
      : 'Kaufbeleg';

  const validStatus =
    parsed.status === 'Archiviert' ||
    parsed.status === 'Aktiv' ||
    parsed.status === 'Offen' ||
    parsed.status === 'Prüfung'
      ? parsed.status
      : validType === 'Vertrag'
        ? 'Aktiv'
        : 'Archiviert';

  return {
    title: (parsed.title || params.fileName || 'Archiviertes Dokument').trim(),
    doc_type: validType,
    vendor: (parsed.vendor || 'Unbekannter Aussteller').trim(),
    doc_number: (parsed.doc_number || '').trim(),
    doc_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.doc_date || '')
      ? (parsed.doc_date as string)
      : new Date().toISOString().slice(0, 10),
    amount_eur:
      typeof parsed.amount_eur === 'number' && Number.isFinite(parsed.amount_eur) ? parsed.amount_eur : null,
    tax_eur: null,
    suggested_category_name: parsed.suggested_category_name || 'Sonstiges',
    status: validStatus,
    summary: (parsed.summary || '').trim(),
    extracted_text: (parsed.extracted_text || params.rawText || '').trim(),
    line_items: Array.isArray(parsed.line_items)
      ? parsed.line_items
          .filter((item) => item && item.description)
          .map((item) => ({
            description: String(item.description),
            quantity: item.quantity ? String(item.quantity) : undefined,
            totalCents: Math.round((typeof item.total_eur === 'number' ? item.total_eur : 0) * 100),
          }))
      : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6) : [],
  };
}

export async function analyzeDocumentWithAutoFallback(params: {
  fileBuffer?: Buffer;
  mimeType?: string;
  fileName?: string;
  rawText?: string;
  categories: CategoryRecord[];
}): Promise<{ extraction: AiExtractionResult; source: 'ai' | 'local' }> {
  if (process.env.GEMINI_API_KEY) {
    try {
      const extraction = await analyzeDocumentWithGemini(params);
      return { extraction, source: 'ai' };
    } catch (err) {
      console.warn('Gemini-Analyse fehlgeschlagen, nutze lokale Extraktion:', err);
    }
  }
  const extraction = extractDocumentLocally(params);
  return { extraction, source: 'local' };
}

export async function summarizeDocumentWithGemini(
  doc: DocumentRecord,
  searchQuery?: string,
): Promise<string> {
  const ai = getGeminiClient();

  const queryInstruction = searchQuery?.trim()
    ? `\nDer Nutzer hat aktuell nach "${searchQuery.trim()}" gesucht. Erkläre in deiner Zusammenfassung gezielt, in welchem Kontext "${searchQuery.trim()}" in diesem Dokument vorkommt und fasse den restlichen Inhalt kompakt zusammen.`
    : '\nErstelle eine klare, sachliche Zusammenfassung des Dokumentinhalts in 2 bis 4 deutschen Sätzen.';

  const prompt = `Dokumenttyp: ${doc.doc_type}
Titel: ${doc.title}
Aussteller / Institution: ${doc.vendor}
Akten-/Belegnummer: ${doc.doc_number || '—'}
Datum: ${doc.doc_date}
Kategorie: ${doc.category_name || 'Sonstiges'}
${doc.parent_title ? `Gehört zu Vertrag: ${doc.parent_title}` : ''}
Status: ${doc.status}
Notiz: ${doc.summary}
Volltext:
${doc.extracted_text}
${queryInstruction}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'Du fasst Kaufbelege, Verträge, Monatsabrechnungen und Zeugnisse für ein deutsches Dokumentenarchiv präzise zusammen. Kein Markdown, nur klarer Fließtext in 2-4 Sätzen.',
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Die KI-Zusammenfassung hat keinen Text zurückgegeben.');
  }
  return text;
}
