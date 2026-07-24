import { describe, expect, it } from 'vitest';
import {
  formatSchedulerDate,
  schedulerStatusDisplay,
  SCHEDULER_DATE_FALLBACK,
} from './scheduler-display';

describe('scheduler display', () => {
  it('mapeia os tres estados para rotulos e tons seguros', () => {
    expect(schedulerStatusDisplay.disabled).toEqual({
      label: 'Desativado',
      tone: 'neutral',
    });
    expect(schedulerStatusDisplay.registered).toEqual({
      label: 'Agendado',
      tone: 'ok',
    });
    expect(schedulerStatusDisplay['not-registered']).toEqual({
      label: 'Não registrado',
      tone: 'warning',
    });
  });

  it('formata ISO em pt-BR respeitando o timezone', () => {
    const formatted = formatSchedulerDate(
      '2026-07-25T11:00:00.000Z',
      'America/Sao_Paulo',
    );

    expect(formatted).toContain('25/07/2026');
    expect(formatted).toContain('08:00');
  });

  it('usa fallback para data ausente ou invalida', () => {
    expect(formatSchedulerDate(null)).toBe(SCHEDULER_DATE_FALLBACK);
    expect(formatSchedulerDate('invalid-date')).toBe(SCHEDULER_DATE_FALLBACK);
  });

  it('nao quebra a renderizacao com timezone invalido', () => {
    expect(
      formatSchedulerDate('2026-07-25T11:00:00.000Z', 'Invalid/Timezone'),
    ).not.toBe(SCHEDULER_DATE_FALLBACK);
  });
});
