import type { AnalyticsRepository, AnalyticsSnapshot } from './repositories';

export class AnalyticsService {
  constructor(private readonly analytics: AnalyticsRepository) {}

  async getSnapshot(): Promise<AnalyticsSnapshot> {
    const [
      totalProducts,
      totalApprovedProducts,
      totalGeneratedCopies,
      totalQueuedDispatches,
      totalSentDispatches,
      totalFailedDispatches,
      totalActiveDestinations,
    ] = await Promise.all([
      this.analytics.totalProducts(),
      this.analytics.totalApprovedProducts(),
      this.analytics.totalGeneratedCopies(),
      this.analytics.totalQueuedDispatches(),
      this.analytics.totalSentDispatches(),
      this.analytics.totalFailedDispatches(),
      this.analytics.totalActiveDestinations(),
    ]);

    return {
      totalProducts,
      totalApprovedProducts,
      totalGeneratedCopies,
      totalQueuedDispatches,
      totalSentDispatches,
      totalFailedDispatches,
      totalActiveDestinations,
    };
  }
}
