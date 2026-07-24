import type { SchedulerStatusValue } from './api';

export const SCHEDULER_DATE_FALLBACK = 'Não disponível';

export const schedulerStatusDisplay: Record<
  SchedulerStatusValue,
  { label: string; tone: 'neutral' | 'ok' | 'warning' }
> = {
  disabled: { label: 'Desativado', tone: 'neutral' },
  registered: { label: 'Agendado', tone: 'ok' },
  'not-registered': { label: 'Não registrado', tone: 'warning' },
};

export const formatSchedulerDate = (
  value: string | null,
  timezone?: string | null,
) => {
  if (!value) return SCHEDULER_DATE_FALLBACK;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return SCHEDULER_DATE_FALLBACK;

  const options: Intl.DateTimeFormatOptions = {
    dateStyle: 'short',
    timeStyle: 'medium',
    ...(timezone ? { timeZone: timezone } : {}),
  };

  try {
    return new Intl.DateTimeFormat('pt-BR', options).format(date);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(date);
  }
};
