/**
 * Bull queue untuk penerbitan SSL (dan backup di phase berikutnya).
 *
 * Redis bersifat opsional: bila REDIS_URL kosong atau Redis tidak tersedia,
 * tugas dijalankan inline (urut, langsung) supaya panel tetap berfungsi di
 * development. Di production, set REDIS_URL agar proses SSL tidak memblokir
 * request.
 */
import { env } from '../config/env.js';

const useRedis = Boolean(env.redisUrl);

let sslQueue = null;
let inline = false;

async function ensureQueue() {
  if (!useRedis) {
    inline = true;
    return null;
  }
  if (sslQueue) return sslQueue;
  try {
    const { default: Queue } = await import('bull');
    sslQueue = new Queue('nodepanel:ssl', env.redisUrl, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    await sslQueue.isReady();
    return sslQueue;
  } catch (err) {
    console.warn(`[queue] Redis tidak tersedia (${err.message}) — SSL diproses inline.`);
    inline = true;
    sslQueue = null;
    return null;
  }
}

/**
 * Jalankan tugas SSL. Mengembalikan { queued, result }.
 * result diisi ketika tugas selesai (inline) — untuk mode Redis, tugas
 * berjalan asinkron dan statusnya dipantau lewat job id.
 */
export async function enqueueSslJob(name, payload, worker) {
  const queue = await ensureQueue();

  if (!queue) {
    const result = await worker(payload);
    return { queued: inline, jobId: null, result };
  }

  const job = await queue.add(name, payload);
  return { queued: true, jobId: job.id, result: null };
}

export async function closeQueue() {
  if (sslQueue) await sslQueue.close();
  sslQueue = null;
}
