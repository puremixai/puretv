import {
  BookCatalogResult,
  BookDetail,
  BookListItem,
  BookSearchFailure,
  BookSearchResult,
  BookSource,
} from './book.types';
import { legadoClient } from './legado.client';
import { opdsClient } from './opds.client';

function sourceKind(source?: Pick<BookSource, 'type'>) {
  return source?.type === 'legado' || (source as BookSource | undefined)?.legado ? 'legado' : 'opds';
}

export class BookProvider {
  async getSources(): Promise<BookSource[]> {
    const [opdsSources, legadoSources] = await Promise.all([
      opdsClient.getSources().catch(() => []),
      legadoClient.getSources().catch(() => []),
    ]);
    return [...opdsSources.map((source) => ({ ...source, type: source.type || 'opds' as const })), ...legadoSources];
  }

  async getSourceById(sourceId: string): Promise<BookSource> {
    const sources = await this.getSources();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) throw new Error('未找到对应的电子书源');
    return source;
  }

  async getCatalog(sourceId: string, href?: string): Promise<BookCatalogResult> {
    const source = await this.getSourceById(sourceId);
    return sourceKind(source) === 'legado'
      ? legadoClient.getCatalog(sourceId, href)
      : opdsClient.getCatalog(sourceId, href);
  }

  async getSearchSources(sourceId?: string): Promise<BookSource[]> {
    if (sourceId) return [await this.getSourceById(sourceId)];
    return this.getSources();
  }

  async searchBooksSource(q: string, source: BookSource): Promise<{ source: BookSource; results: BookListItem[] }> {
    return sourceKind(source) === 'legado'
      ? legadoClient.searchBooksSource(q, source)
      : opdsClient.searchBooksSource(q, source);
  }

  async searchBooks(q: string, sourceId?: string): Promise<BookSearchResult> {
    const sources = await this.getSearchSources(sourceId);
    const results: BookListItem[] = [];
    const failedSources: BookSearchFailure[] = [];
    await Promise.all(sources.map(async (source) => {
      try {
        const sourceResult = await this.searchBooksSource(q, source);
        results.push(...sourceResult.results);
      } catch (error) {
        failedSources.push({ sourceId: source.id, sourceName: source.name, error: (error as Error).message });
      }
    }));
    return { results, failedSources };
  }

  async getBookDetail(sourceId: string, href: string, fallback?: Partial<BookDetail>): Promise<BookDetail> {
    const source = await this.getSourceById(sourceId);
    return sourceKind(source) === 'legado'
      ? legadoClient.getBookDetail(sourceId, href, fallback)
      : opdsClient.getBookDetail(sourceId, href, fallback);
  }

  async getPreferredAcquisition(sourceId: string, href: string): Promise<{ format: 'epub' | 'pdf' | 'chapters'; href: string }> {
    const source = await this.getSourceById(sourceId);
    if (sourceKind(source) === 'legado') {
      const detail = await legadoClient.getBookDetail(sourceId, href);
      const chapters = detail.acquisitionLinks.find((item) => item.type === 'application/x-legado-chapters+json') || detail.acquisitionLinks[0];
      if (!chapters?.href) throw new Error('当前书籍没有可用章节目录');
      return { format: 'chapters', href: chapters.href };
    }
    return opdsClient.getPreferredAcquisition(sourceId, href);
  }
}

export const bookProvider = new BookProvider();
