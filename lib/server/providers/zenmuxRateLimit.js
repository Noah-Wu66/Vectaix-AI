import mongoose from 'mongoose';
import dbConnect from '@/lib/db';

const ZENMUX_RATE_LIMIT_ID = 'zenmux-global';
const ZENMUX_LIMIT = 10;
const ZENMUX_WINDOW_MS = 60 * 1000;
const ZENMUX_EMISSION_INTERVAL_MS = Math.ceil(ZENMUX_WINDOW_MS / ZENMUX_LIMIT);
const ZENMUX_BURST_TOLERANCE_MS = Math.max(0, ZENMUX_WINDOW_MS - ZENMUX_EMISSION_INTERVAL_MS);
const WAIT_LOG_THRESHOLD_MS = 500;

const ZenMuxRateLimitSchema = new mongoose.Schema(
  {
    _id: { type: String },
    tatMs: { type: Number, default: 0 },
    lastReservedAtMs: { type: Number, default: 0 },
    createdAt: { type: Number, default: Date.now },
    updatedAt: { type: Number, default: Date.now },
  },
  {
    collection: 'provider_rate_limit_states',
    versionKey: false,
  }
);

const ZenMuxRateLimitState =
  mongoose.models.ZenMuxRateLimitState || mongoose.model('ZenMuxRateLimitState', ZenMuxRateLimitSchema);

function createAbortError() {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function resolveLabel(label, input) {
  if (typeof label === 'string' && label.trim()) return label.trim();
  if (typeof input === 'string' && input) return input;
  if (input && typeof input.url === 'string' && input.url) return input.url;
  return 'zenmux';
}

function waitWithSignal(delayMs, signal) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve();
  }

  if (!signal) {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function reserveZenmuxSlot() {
  await dbConnect();

  const nowMs = Date.now();
  const state = await ZenMuxRateLimitState.findOneAndUpdate(
    { _id: ZENMUX_RATE_LIMIT_ID },
    [
      {
        $set: {
          lastReservedAtMs: {
            $let: {
              vars: {
                currentTatMs: { $ifNull: ['$tatMs', nowMs] },
              },
              in: {
                $cond: [
                  { $gt: [{ $subtract: ['$$currentTatMs', ZENMUX_BURST_TOLERANCE_MS] }, nowMs] },
                  { $subtract: ['$$currentTatMs', ZENMUX_BURST_TOLERANCE_MS] },
                  nowMs,
                ],
              },
            },
          },
          tatMs: {
            $let: {
              vars: {
                currentTatMs: { $ifNull: ['$tatMs', nowMs] },
              },
              in: {
                $add: [
                  { $cond: [{ $gt: ['$$currentTatMs', nowMs] }, '$$currentTatMs', nowMs] },
                  ZENMUX_EMISSION_INTERVAL_MS,
                ],
              },
            },
          },
          createdAt: { $ifNull: ['$createdAt', nowMs] },
          updatedAt: nowMs,
        },
      },
    ],
    {
      new: true,
      upsert: true,
    }
  );

  const reservedAtMs = Number(state?.lastReservedAtMs) || nowMs;
  return {
    nowMs,
    reservedAtMs,
    waitMs: Math.max(0, reservedAtMs - nowMs),
  };
}

export async function waitForZenmuxSlot({ label, signal } = {}) {
  const reservation = await reserveZenmuxSlot();

  if (reservation.waitMs >= WAIT_LOG_THRESHOLD_MS) {
    console.info('[ZenMuxQueue] Waiting for shared provider slot', {
      label: resolveLabel(label),
      waitMs: reservation.waitMs,
      reservedAt: new Date(reservation.reservedAtMs).toISOString(),
      limit: ZENMUX_LIMIT,
      windowMs: ZENMUX_WINDOW_MS,
    });
  }

  if (reservation.waitMs > 0) {
    await waitWithSignal(reservation.waitMs, signal);
  }

  return reservation;
}

export async function fetchWithZenmuxRateLimit(input, init = {}, { label } = {}) {
  await waitForZenmuxSlot({
    label: resolveLabel(label, input),
    signal: init?.signal,
  });
  return fetch(input, init);
}

export function createZenmuxAwareFetch({ label } = {}) {
  return async (input, init = {}) => fetchWithZenmuxRateLimit(input, init, { label });
}

export const ZENMUX_RATE_LIMIT = Object.freeze({
  limit: ZENMUX_LIMIT,
  windowMs: ZENMUX_WINDOW_MS,
  emissionIntervalMs: ZENMUX_EMISSION_INTERVAL_MS,
});
