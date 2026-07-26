export const formatCurrency = (value?: number | null) =>
  typeof value === 'number'
    ? new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(value)
    : '—';

export const formatNumber = (value?: number | null) =>
  typeof value === 'number'
    ? new Intl.NumberFormat('pt-BR').format(value)
    : '—';

export const formatPercent = (value?: number | null) =>
  typeof value === 'number'
    ? `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(
        value,
      )}%`
    : '—';

export const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

export const formatDateTimeInTimezone = (
  value: string | null | undefined,
  timezone: string | null | undefined,
  fallback: string,
  timeStyle: 'short' | 'medium' = 'short',
) => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const format = (timeZone?: string) =>
    new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle,
      ...(timeZone ? { timeZone } : {}),
    }).format(date);

  try {
    return format(timezone ?? undefined);
  } catch {
    return format();
  }
};

export const maskDestination = (destination?: string) => {
  if (!destination) return '—';
  if (destination.length <= 6) return destination;
  return `${destination.slice(0, 3)}...${destination.slice(-3)}`;
};
