/**
 * Expose client-safe messages while keeping database/provider internals out of
 * public responses. Route/service errors may set statusCode for expected 4xx
 * failures; unexpected 5xx failures always receive a stable fallback.
 */
function publicErrorMessage(error, fallback) {
  const status = error?.statusCode || error?.status || 500;
  return status < 500 && error?.message ? error.message : fallback;
}

module.exports = { publicErrorMessage };
