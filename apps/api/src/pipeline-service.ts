import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type { HunterProvider } from '@shopee-auto-affiliate-ai/providers';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';

  produtosEncontrados: number;
  produtosPontuados: number;
  produtosAprovados: number;
  copiesGeradas: number;
  tempoExecucao: string;
};


        produtosAprovados: produtosAprovados.length,
        copiesGeradas,
        tempoExecucao: `${Date.now() - inicio}ms`,
      };

      this.options.logger.info(

    }
  }
}
