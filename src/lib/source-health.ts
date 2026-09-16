export interface SourceHealth {
  api: string;
  checkedAt: number;
  keyword: string;
  checks: number;
  successes: number;
  consecutiveFailures: number;
  latencyMs: number;
  searchLatencyMs: number;
  playbackLatencyMs?: number;
  status: 'valid' | 'no_results' | 'invalid';
  message: string;
}
export function effectiveSourceWeight(
  weight: number,
  health?: SourceHealth
): number {
  if (!health || Date.now() - health.checkedAt > 7 * 86400_000) return weight;
  const failurePenalty =
    health.consecutiveFailures >= 3
      ? Math.min(100, health.consecutiveFailures * 20)
      : 0;
  const latencyPenalty =
    health.latencyMs > 3000
      ? Math.min(15, Math.floor(health.latencyMs / 1000))
      : 0;
  return weight - failurePenalty - latencyPenalty;
}
export function updateHealth(
  previous: SourceHealth | undefined,
  result: Omit<SourceHealth, 'checks' | 'successes' | 'consecutiveFailures'>
): SourceHealth {
  const old = previous?.api === result.api ? previous : undefined;
  return {
    ...result,
    checks: (old?.checks || 0) + 1,
    successes: (old?.successes || 0) + (result.status === 'valid' ? 1 : 0),
    consecutiveFailures:
      result.status === 'invalid'
        ? (old?.consecutiveFailures || 0) + 1
        : result.status === 'valid'
        ? 0
        : old?.consecutiveFailures || 0,
  };
}
