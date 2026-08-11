export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 500;

/**
 * Normalize `?page=&limit=` query params into a safe { limit, offset, page }.
 * Applied consistently across every list endpoint: page defaults to 1,
 * limit defaults to 10 and is capped at 500 regardless of what's requested.
 */
export function parsePagination(query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  let limit = Math.floor(Number(query.limit));
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  limit = Math.min(limit, maxLimit);

  let page = Math.floor(Number(query.page));
  if (!Number.isFinite(page) || page < 1) page = 1;

  const offset = (page - 1) * limit;
  return { limit, offset, page };
}
