import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { COPY_TEMPLATES, CopyService, TemplateEngine, type CopyProduct } from '../src/copy-service';

const product: CopyProduct = {
  id: 'product-1',
  nome: 'Fone Bluetooth',
  categoria: 'Eletrônicos',
  preco: 99.9,
  desconto: 25,
  nota: 4.8,
  comissao: 0.12,
};

const logger = { info: vi.fn(), error: vi.fn() };

const createPrismaMock = (foundProduct: CopyProduct | null = product) => ({
  $disconnect: vi.fn(),
  productLead: {
    findUnique: vi.fn(async () => foundProduct),
  },
  generatedCopy: {
    create: vi.fn(async ({ data }: { data: unknown }) => ({ id: 'copy-1', ...data })),
  },
});

describe('TemplateEngine', () => {
  it('substitui placeholders conhecidos e preserva placeholders desconhecidos', () => {
    const engine = new TemplateEngine();
    expect(engine.render('Compre {{ nome }} por {{preco}} {{desconhecido}}', { nome: 'Produto', preco: 'R$ 10,00' })).toBe(
      'Compre Produto por R$ 10,00 {{desconhecido}}',
    );
  });
});

describe('CopyService', () => {
  it('possui pelo menos 8 templates', () => {
    expect(COPY_TEMPLATES).toHaveLength(8);
  });

  it('renderiza todos os templates sem placeholders pendentes', () => {
    const service = new CopyService({ prisma: createPrismaMock() as never, logger });

    for (const template of COPY_TEMPLATES) {
      const copy = service.renderTemplate(template, product);
      expect(copy.titulo).not.toMatch(/{{|}}/);
      expect(copy.mensagem).not.toMatch(/{{|}}/);
      expect(copy.cta).not.toMatch(/{{|}}/);
      expect(copy.hashtags).not.toMatch(/{{|}}/);
      expect(copy.titulo.length).toBeGreaterThan(0);
      expect(copy.mensagem).toContain('Fone Bluetooth');
      expect(copy.hashtags).toContain('#');
    }
  });

  it('persiste uma nova copy no banco a cada geração', async () => {
    const prisma = createPrismaMock();
    const service = new CopyService({ prisma: prisma as never, logger });

    const copy = await service.generate('product-1');

    expect(prisma.productLead.findUnique).toHaveBeenCalledWith({ where: { id: 'product-1' } });
    expect(prisma.generatedCopy.create).toHaveBeenCalledWith({ data: { productId: 'product-1', ...copy } });
  });

  it('lança erro quando produto não existe', async () => {
    const service = new CopyService({ prisma: createPrismaMock(null) as never, logger });
    await expect(service.generate('missing')).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });

  it('expõe POST /copy/generate e retorna a copy persistida', async () => {
    const prisma = createPrismaMock();
    const app = await buildApp({ logger: false, prisma: prisma as never });

    const response = await app.inject({
      method: 'POST',
      url: '/copy/generate',
      payload: { productId: 'product-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      titulo: expect.any(String),
      mensagem: expect.any(String),
      cta: expect.any(String),
      hashtags: expect.any(String),
    });
    expect(prisma.generatedCopy.create).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('retorna 400 quando productId não é enviado ao endpoint', async () => {
    const app = await buildApp({ logger: false, prisma: createPrismaMock() as never });
    const response = await app.inject({ method: 'POST', url: '/copy/generate', payload: {} });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
