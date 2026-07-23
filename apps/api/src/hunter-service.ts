import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type { HunterProvider } from '@shopee-auto-affiliate-ai/providers';
import type { Product, ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

export type HunterRunResult = {
  encontrados: number;
  novos: number;
  atualizados: number;
  tempoExecucao: string;
};

export type HunterServiceOptions = {
  provider: HunterProvider;
  prisma: Pick<DatabaseClient, 'productLead'>;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
};

const toProductLeadData = (produto: Product) => ({
  providerProductId: produto.id,
  nome: produto.nome,
  categoria: produto.categoria,
  preco: produto.preco,
  desconto: produto.desconto,
  nota: produto.nota,
  vendidos: produto.vendidos,
  comissao: produto.comissao,
  loja: produto.loja,
  urlImagem: produto.urlImagem,
  url: produto.url,
  title: produto.nome,
});

export class HunterService {
  constructor(private readonly options: HunterServiceOptions) {}

  async run(filters?: ProductFilters): Promise<HunterRunResult> {
    const inicio = Date.now();
    this.options.logger.info({ event: 'hunter.run.started', filters }, 'Hunter execution started');

    try {
      const produtos = await this.options.provider.buscarProdutos(filters);
      let novos = 0;
      let atualizados = 0;

      for (const produto of produtos) {
        const existente = await this.options.prisma.productLead.findUnique({
          where: { providerProductId: produto.id },
          select: { id: true },
        });

        if (existente) {
          await this.options.prisma.productLead.update({
            where: { providerProductId: produto.id },
            data: toProductLeadData(produto),
          });
          atualizados += 1;
        } else {
          await this.options.prisma.productLead.create({ data: toProductLeadData(produto) });
          novos += 1;
        }
      }

      const resultado = {
        encontrados: produtos.length,
        novos,
        atualizados,
        tempoExecucao: `${Date.now() - inicio}ms`,
      };

      this.options.logger.info({ event: 'hunter.run.completed', ...resultado }, 'Hunter execution completed');
      return resultado;
    } catch (error) {
      this.options.logger.error({ event: 'hunter.run.failed', error }, 'Hunter execution failed');
      throw new AppError('Falha ao executar Hunter Agent', 'HUNTER_RUN_FAILED');
    }
  }
}
