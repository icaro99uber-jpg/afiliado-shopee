import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type {
  GeneratedCopyRepository,
  ProductRepository,
} from './repositories';

export type CopyProduct = {
  id: string;
  nome: string;
  categoria: string;
  preco: number;
  desconto: number;
  nota: number;
  comissao: number;
};

export type GeneratedCopyResponse = {
  titulo: string;
  mensagem: string;
  cta: string;
  hashtags: string;
};

type CopyTemplate = {
  id: string;
  titulo: string;
  mensagem: string;
  cta: string;
  hashtags: string;
};

export type CopyServiceOptions = {
  products: ProductRepository;
  generatedCopies: GeneratedCopyRepository;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatPercent = (value: number) => {
  const percent = value <= 1 ? value * 100 : value;
  return `${Number(percent.toFixed(2)).toLocaleString('pt-BR')}%`;
};

const normalizeHashtags = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((hashtag) =>
      hashtag.startsWith('#')
        ? `#${hashtag
            .slice(1)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '')}`
        : hashtag,
    )
    .join(' ');

export class TemplateEngine {
  render(template: string, placeholders: Record<string, string>): string {
    return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key: string) => placeholders[key] ?? match);
  }
}

export const COPY_TEMPLATES: CopyTemplate[] = [
  {
    id: 'oferta-relampago',
    titulo: '🔥 Oferta Relâmpago: {{nome}} por {{preco}}',
    mensagem: 'Corre! {{nome}} na categoria {{categoria}} está com {{desconto}} de desconto, nota {{nota}} e comissão de {{comissao}}.',
    cta: 'Garanta agora antes que a oferta acabe!',
    hashtags: '#OfertaRelampago #{{categoria}} #Desconto{{desconto}}',
  },
  {
    id: 'desconto-imperdivel',
    titulo: '💥 Desconto Imperdível em {{nome}}',
    mensagem: 'Achado com preço de {{preco}}, desconto de {{desconto}}, nota {{nota}} e comissão {{comissao}} para divulgar hoje.',
    cta: 'Clique e aproveite esse desconto!',
    hashtags: '#DescontoImperdivel #Shopee #{{categoria}}',
  },
  {
    id: 'frete-gratis',
    titulo: '🚚 Frete Grátis combina com {{nome}}',
    mensagem: '{{nome}} é uma opção de {{categoria}} por {{preco}}, com {{desconto}} off, nota {{nota}} e comissão {{comissao}}.',
    cta: 'Confira se o frete grátis está disponível para seu CEP!',
    hashtags: '#FreteGratis #OfertaShopee #{{categoria}}',
  },
  {
    id: 'mais-vendido',
    titulo: '⭐ Mais Vendido: {{nome}}',
    mensagem: 'Produto queridinho em {{categoria}}: {{nome}} por {{preco}}, desconto {{desconto}}, nota {{nota}} e comissão {{comissao}}.',
    cta: 'Veja os detalhes e compre com segurança!',
    hashtags: '#MaisVendido #TopOferta #{{categoria}}',
  },
  {
    id: 'produto-campeao',
    titulo: '❤️ Produto Campeão para economizar: {{nome}}',
    mensagem: 'Esse campeão de {{categoria}} sai por {{preco}}, entrega {{desconto}} de desconto, nota {{nota}} e comissão {{comissao}}.',
    cta: 'Aproveite enquanto ainda está disponível!',
    hashtags: '#ProdutoCampeao #Achadinhos #{{categoria}}',
  },
  {
    id: 'achado-do-dia',
    titulo: '🎁 Achado do Dia: {{nome}}',
    mensagem: 'Selecionamos {{nome}} em {{categoria}} por {{preco}} com {{desconto}} off, nota {{nota}} e comissão de {{comissao}}.',
    cta: 'Pegue esse achadinho agora!',
    hashtags: '#AchadoDoDia #Oferta #{{categoria}}',
  },
  {
    id: 'promocao-limitada',
    titulo: '⚡ Promoção Limitada: {{nome}}',
    mensagem: 'Pouco tempo para aproveitar {{nome}} por {{preco}}. Categoria {{categoria}}, desconto {{desconto}}, nota {{nota}} e comissão {{comissao}}.',
    cta: 'Não deixe para depois!',
    hashtags: '#PromocaoLimitada #Desconto #{{categoria}}',
  },
  {
    id: 'custo-beneficio',
    titulo: '🏆 Melhor Custo Benefício: {{nome}}',
    mensagem: '{{nome}} une preço de {{preco}}, {{desconto}} de desconto, nota {{nota}}, categoria {{categoria}} e comissão {{comissao}}.',
    cta: 'Compare e aproveite essa oportunidade!',
    hashtags: '#CustoBeneficio #CompraInteligente #{{categoria}}',
  },
];

export class CopyService {
  private readonly engine = new TemplateEngine();

  constructor(private readonly options: CopyServiceOptions) {}

  generateFromProduct(product: CopyProduct): GeneratedCopyResponse {
    const template = COPY_TEMPLATES[Math.floor(Math.random() * COPY_TEMPLATES.length)];
    return this.renderTemplate(template, product);
  }

  renderTemplate(template: CopyTemplate, product: CopyProduct): GeneratedCopyResponse {
    const placeholders = {
      nome: product.nome,
      preco: formatCurrency(product.preco),
      desconto: formatPercent(product.desconto),
      comissao: formatPercent(product.comissao),
      categoria: product.categoria,
      nota: product.nota.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    };

    return {
      titulo: this.engine.render(template.titulo, placeholders),
      mensagem: this.engine.render(template.mensagem, placeholders),
      cta: this.engine.render(template.cta, placeholders),
      hashtags: normalizeHashtags(this.engine.render(template.hashtags, placeholders)),
    };
  }

  async generate(productId: string): Promise<GeneratedCopyResponse> {
    this.options.logger.info({ event: 'copy.generate.started', productId }, 'Copy generation started');

    try {
      const product = await this.options.products.findById(productId);
      if (!product) throw new AppError('Produto não encontrado', 'PRODUCT_NOT_FOUND');

      const copy = this.generateFromProduct(product);
      const persistedCopy = await this.options.generatedCopies.create({
        productId,
        ...copy,
      });

      this.options.logger.info({ event: 'copy.generate.completed', productId }, 'Copy generation completed');
      return persistedCopy;
    } catch (error) {
      this.options.logger.error({ event: 'copy.generate.failed', productId, error }, 'Copy generation failed');
      if (error instanceof AppError) throw error;
      throw new AppError('Falha ao gerar copy', 'COPY_GENERATE_FAILED');
    }
  }
}
