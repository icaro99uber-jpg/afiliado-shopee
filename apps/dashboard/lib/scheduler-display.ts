import type { SchedulerStatusValue } from './api';
import { formatDateTimeInTimezone } from './format';

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
) =>
  formatDateTimeInTimezone(value, timezone, SCHEDULER_DATE_FALLBACK, 'medium');
