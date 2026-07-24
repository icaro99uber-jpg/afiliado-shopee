import { describe, expect, it } from 'vitest';
import { sanitizeDispatchDestination } from '../src/app';

describe('sanitizeDispatchDestination', () => {
  it('substitui o JID de grupo pelo fingerprint e omite a instancia interna', () => {
    const serialized = sanitizeDispatchDestination({
      destination: '100000000000000000@g.us',
      type: 'GROUP',
      active: true,
      available: true,
      fingerprint: 'grp_123456789abc',
      sourceInstanceName: 'private-instance',
    });

    expect(serialized).toEqual({
      type: 'GROUP',
      active: true,
      available: true,
      fingerprint: 'grp_123456789abc',
      destination: 'grp_123456789abc',
    });
    expect(JSON.stringify(serialized)).not.toContain('@g.us');
    expect(JSON.stringify(serialized)).not.toContain('private-instance');
  });

  it('mantem a resposta individual mascarada', () => {
    expect(
      sanitizeDispatchDestination({
        destination: '5511999999999',
        type: 'INDIVIDUAL',
        active: true,
        available: true,
        fingerprint: null,
        sourceInstanceName: null,
      }).destination,
    ).toBe('*********9999');
  });
});
