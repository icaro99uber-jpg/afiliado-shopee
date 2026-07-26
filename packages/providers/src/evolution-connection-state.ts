export const parseEvolutionConnectionState = (body: unknown) => {
  if (!body || typeof body !== 'object') return undefined;
  const value = body as { state?: unknown; instance?: { state?: unknown } };
  const state = value.instance?.state ?? value.state;
  return typeof state === 'string' ? state.toLowerCase() : undefined;
};
