"use strict";

const { isSensitiveHeader } = require("../utils/sensitive-headers");

const ACTIVE = new Set(["connecting", "downloading", "processing"]);
const DETACHED_SEED_LIMIT = 2;

function isWithinSchedule(settings, date = new Date()) {
  if (!settings.scheduleEnabled) return true;
  const start = settings.scheduleStartMinute ?? 0;
  const end = settings.scheduleEndMinute ?? 360;
  const now = date.getHours() * 60 + date.getMinutes();
  if (start === end) return true;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

function persistentHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([key]) => !isSensitiveHeader(key)),
  );
}

module.exports = {
  ACTIVE,
  DETACHED_SEED_LIMIT,
  isWithinSchedule,
  persistentHeaders,
};
