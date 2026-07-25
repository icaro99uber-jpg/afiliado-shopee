import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

const parseCsvRows = (content: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field.trim());
      field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  if (quoted)
    throw new AppError('CSV possui aspas abertas', 'INVALID_IMPORT_FILE');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const csvToRecords = (content: string): unknown[] => {
  const [headers, ...rows] = parseCsvRows(content);
  if (!headers?.length) return [];
  return rows.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => {
        const value = values[index] ?? '';
        if (header === 'categoryIds') {
          return [
            header,
            value ? value.split(';').map((item) => item.trim()) : [],
          ];
        }
        return [header, value || undefined];
      }),
    ),
  );
};

export const readShopeeManualImportFile = async (filePath: string) => {
  const extension = extname(filePath).toLocaleLowerCase();
  if (!['.json', '.csv'].includes(extension)) {
    throw new AppError(
      'Formato de arquivo deve ser JSON ou CSV',
      'INVALID_IMPORT_FILE',
    );
  }
  const content = await readFile(filePath, 'utf8');
  let records: unknown[];
  if (extension === '.csv') {
    records = csvToRecords(content);
  } else {
    try {
      const parsed = JSON.parse(content) as unknown;
      records = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      throw new AppError('JSON invalido', 'INVALID_IMPORT_FILE');
    }
  }
  if (records.length < 1 || records.length > 100) {
    throw new AppError(
      'Arquivo deve conter entre 1 e 100 ofertas',
      'INVALID_IMPORT_FILE',
    );
  }
  return records;
};
