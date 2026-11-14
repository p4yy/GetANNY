function isSensitiveHeader(name) {
  return /cookie|session|authorization|credential|token|api[-_]?key|csrf|xsrf|signature/i.test(
    name,
  );
}

function redactLogText(value) {
  return String(value).replace(
    /([\w-]*(?:cookie|session|authorization|credential|token|api[-_]?key|csrf|xsrf|signature)[\w-]*["']?\s*[:=]\s*)[^\r\n]*/gi,
    "$1[redacted]",
  );
}

module.exports = { isSensitiveHeader, redactLogText };
