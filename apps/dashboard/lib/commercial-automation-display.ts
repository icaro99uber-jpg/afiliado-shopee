import type { CommercialAutomationReason } from './api';
import { formatDateTimeInTimezone } from './format';

export const commercialAutomationReasonLabels: Record<
  CommercialAutomationReason,
  string
> = {
  AUTOMATION_DISABLED: 'Automação desabilitada pelo ambiente.',
  AUTOMATION_PAUSED: 'Automação pausada operacionalmente.',
  OUTSIDE_ALLOWED_WINDOW: 'Fora do horário permitido.',
  GLOBAL_DAILY_LIMIT_REACHED: 'Limite diário global atingido.',
  GROUP_DAILY_LIMIT_REACHED: 'Limite diário do grupo atingido.',
  MINIMUM_INTERVAL_NOT_REACHED: 'Intervalo mínimo ainda não atingido.',
  NO_AUTHORIZED_GROUP: 'Nenhum grupo autorizado e disponível.',
  MULTIPLE_AUTHORIZED_GROUPS: 'Mais de um grupo autorizado e disponível.',
  AMBIGUOUS_COMMERCIAL_RUN_EXISTS:
    'Existe uma execução comercial ambígua que exige investigação manual.',
};

export const formatCommercialAutomationDate = (
  value: string | null,
  timezone: string,
) => formatDateTimeInTimezone(value, timezone, 'Não registrado');
