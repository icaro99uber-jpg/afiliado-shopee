import { describe, it, expect } from 'vitest';
import { parseShopeeOfficialCatalogCliArgs } from '../src/shopee-official-catalog-cli-parser';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

describe('parseShopeeOfficialCatalogCliArgs', () => {
  const limits = {
    maximumPageSize: 20,
    maximumPages: 3,
    maximumProducts: 500,
  };

  it('deve parsear argumentos sem separador', () => {
    const result = parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--keyword=teste'], limits);
    expect(result.keyword).toBe('teste');
  });

  it('deve parsear argumentos com separador', () => {
    const result = parseShopeeOfficialCatalogCliArgs(['npm', 'run', 'script', '--', '--confirm-local-official-catalog-sync', '--keyword=teste'], limits);
    expect(result.keyword).toBe('teste');
  });

  it('deve exigir confirmacao obrigatoria', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs([], limits)).toThrowError(AppError);
  });

  it('deve rejeitar confirmacao duplicada', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--confirm-local-official-catalog-sync'], limits)).toThrowError(AppError);
  });

  it('deve rejeitar flag duplicada', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--keyword=a', '--keyword=b'], limits)).toThrowError(AppError);
  });

  it('deve rejeitar flag desconhecida', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--invalid=true'], limits)).toThrowError(AppError);
  });

  it('deve rejeitar argumento posicional', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', 'posicional'], limits)).toThrowError(AppError);
  });

  it('deve rejeitar valor ausente', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--keyword='], limits)).toThrowError(AppError);
  });

  it('deve fazer trim e manter keyword', () => {
    const result = parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--keyword= teste '], limits);
    expect(result.keyword).toBe('teste');
  });

  it('deve normalizar keyword NFKC', () => {
    const result = parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--keyword=tẽst'], limits);
    expect(result.keyword).toBe('tẽst'.normalize('NFKC'));
  });

  it('deve rejeitar keyword vazia', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--keyword=  '], limits)).toThrowError(AppError);
  });

  it('deve rejeitar controle ASCII', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--keyword=test\na'], limits)).toThrowError(AppError);
  });

  it('deve parsear category ID', () => {
    const result = parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--category-id=123'], limits);
    expect(result.categoryId).toBe(123);
  });

  it('deve parsear todos os sorts permitidos', () => {
    const sorts = ['relevance', 'price_asc', 'price_desc', 'commission_desc', 'sales_desc'];
    for (const sort of sorts) {
      const result = parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', `--sort=${sort}`], limits);
      expect(result.sort).toBe(sort);
    }
  });

  it('deve rejeitar sort invalido', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--sort=invalid'], limits)).toThrowError(AppError);
  });

  it('deve aceitar pageSize igual ao maximo', () => {
    const result = parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--page-size=20'], limits);
    expect(result.pageSize).toBe(20);
  });

  it('deve rejeitar pageSize acima do maximo', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--page-size=21'], limits)).toThrowError(AppError);
  });

  it('deve aceitar maxPages igual ao maximo', () => {
    const result = parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--max-pages=2'], limits);
    expect(result.maxPages).toBe(2);
  });

  it('deve rejeitar maxPages acima do maximo', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--max-pages=4'], limits)).toThrowError(AppError);
  });

  it('deve aceitar total dentro do maximo', () => {
    const result = parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--page-size=10', '--max-pages=5'], {
      maximumPageSize: 20,
      maximumPages: 5,
      maximumProducts: 50
    });
    expect(result.pageSize).toBe(10);
    expect(result.maxPages).toBe(5);
  });

  it('deve rejeitar total acima do maximo', () => {
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync', '--page-size=20', '--max-pages=3'], {
      maximumPageSize: 20,
      maximumPages: 3,
      maximumProducts: 50
    })).toThrowError(AppError);
  });

  it('deve considerar defaults no calculo do total se nao exceder o total', () => {
    // defaults: 20 * 3 = 60 > 50, should throw
    expect(() => parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync'], {
      maximumPageSize: 20,
      maximumPages: 3,
      maximumProducts: 50
    })).toThrowError(AppError);
  });

  it('deve considerar defaults no calculo do total e passar se limite for maior', () => {
    const result = parseShopeeOfficialCatalogCliArgs(['--confirm-local-official-catalog-sync'], {
      maximumPageSize: 20,
      maximumPages: 2,
      maximumProducts: 50,
    });
    expect(result.pageSize).toBe(20);
    expect(result.maxPages).toBe(2);
  });
});
