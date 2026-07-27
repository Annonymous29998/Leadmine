/** Lightweight text pull from PDF / Office bytes (Sniffy-style). */

import { PDFParse } from 'pdf-parse';

export async function extractTextFromPdf(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buf.subarray(0, Math.min(buf.length, 4_000_000)) });
  try {
    const result = await parser.getText({ first: 1, last: 25 });
    return result.text || '';
  } catch {
    // Fallback: emails often survive as literal strings in PDF streams
    return buf.toString('latin1');
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/** OOXML (docx/xlsx/pptx) stores plain text in XML — latin1 scan catches most emails. */
export function extractTextFromOffice(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const xmlBits = [...raw.matchAll(/>([^<>]{3,200})</g)].map((m) => m[1]).join(' ');
  return `${xmlBits}\n${raw}`;
}

export function isPdfUrl(url: string, contentType: string): boolean {
  return /application\/pdf/i.test(contentType) || /\.pdf(\?|$)/i.test(url);
}

export function isOfficeUrl(url: string, contentType: string): boolean {
  if (/\.(docx?|xlsx?|pptx?)(\?|$)/i.test(url)) return true;
  return /officedocument|msword|ms-excel|ms-powerpoint|spreadsheetml|presentationml/i.test(
    contentType,
  );
}
