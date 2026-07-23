export type Product = { id: string; title: string; price: number; rating?: number; sales?: number; commissionRate?: number; url?: string };
export type ScoredProduct = Product & { score: number; reasons: string[] };
export class AppError extends Error { constructor(message: string, public readonly code = 'APP_ERROR') { super(message); } }
export const nowIso = () => new Date().toISOString();
