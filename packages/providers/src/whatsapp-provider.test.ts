import { describe, expect, it } from 'vitest';
import { MockWhatsAppProvider, parseEvolutionConnectionState } from './index';

describe('parseEvolutionConnectionState', () => {
  it('aceita os dois formatos read-only da Evolution', () => {
    expect(parseEvolutionConnectionState({ state: 'OPEN' })).toBe('open');
    expect(
      parseEvolutionConnectionState({ instance: { state: 'close' } }),
    ).toBe('close');
    expect(parseEvolutionConnectionState({ status: 'open' })).toBeUndefined();
  });
});

describe('MockWhatsAppProvider', () => {
  it('envia uma mensagem e registra chamada em memória', async () => {
    const provider = new MockWhatsAppProvider();
    await expect(
      provider.sendMessage({ destination: 'mock-group-01', message: 'Oferta' }),
    ).resolves.toMatchObject({
      externalMessageId: 'mock-whatsapp-1',
      status: 'sent',
      sentAt: expect.any(Date),
    });
    expect(provider.sentMessages).toEqual([
      { destination: 'mock-group-01', message: 'Oferta' },
    ]);
  });

  it('rejeita destino vazio', async () => {
    await expect(
      new MockWhatsAppProvider().sendMessage({
        destination: ' ',
        message: 'Oferta',
      }),
    ).rejects.toThrow('Destino WhatsApp é obrigatório');
  });

  it('rejeita mensagem vazia', async () => {
    await expect(
      new MockWhatsAppProvider().sendMessage({
        destination: 'mock-group-01',
        message: ' ',
      }),
    ).rejects.toThrow('Mensagem WhatsApp é obrigatória');
  });

  it('permite configurar falha simulada', async () => {
    const provider = new MockWhatsAppProvider();
    provider.simulateFailure('falha simulada');
    await expect(
      provider.sendMessage({ destination: 'mock-group-01', message: 'Oferta' }),
    ).rejects.toThrow('falha simulada');
  });

  it('registra envio de imagem com URL http ou https e preserva em sentMessages', async () => {
    const provider = new MockWhatsAppProvider();
    await provider.sendMessage({
      destination: 'mock-group-01',
      message: 'Oferta com imagem',
      imageUrl: 'https://example.com/item.jpg',
    });

    expect(provider.sentMessages).toEqual([
      {
        destination: 'mock-group-01',
        message: 'Oferta com imagem',
        imageUrl: 'https://example.com/item.jpg',
      },
    ]);
  });

  it.each(['', '   ', 'not-a-url', 'ftp://example.com/img.jpg', 'javascript:alert(1)'])(
    'rejeita imagem invalida (%s) sem registrar em sentMessages',
    async (invalidUrl) => {
      const provider = new MockWhatsAppProvider();

      await expect(
        provider.sendMessage({
          destination: 'mock-group-01',
          message: 'Oferta',
          imageUrl: invalidUrl,
        }),
      ).rejects.toMatchObject({
        code: 'WHATSAPP_IMAGE_URL_INVALID',
      });

      expect(provider.sentMessages).toHaveLength(0);
    },
  );

  it('permite falha simulada tambem para envio de imagem', async () => {
    const provider = new MockWhatsAppProvider();
    provider.simulateFailure('falha imagem');

    await expect(
      provider.sendMessage({
        destination: 'mock-group-01',
        message: 'Oferta',
        imageUrl: 'https://example.com/img.jpg',
      }),
    ).rejects.toThrow('falha imagem');

    expect(provider.sentMessages).toHaveLength(0);
  });
});
