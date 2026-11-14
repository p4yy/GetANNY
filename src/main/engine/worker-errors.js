function serializeError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code,
    statusCode: error?.statusCode,
    retryable: error?.retryable === true,
    retryAfterMs: error?.retryAfterMs,
  };
}

function deserializeError(data) {
  return Object.assign(new Error(data.message), data);
}

module.exports = { serializeError, deserializeError };
