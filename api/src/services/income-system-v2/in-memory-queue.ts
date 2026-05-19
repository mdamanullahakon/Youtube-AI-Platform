// In-memory queue fallback for BullMQ (Redis 3.x compatibility)
// Used when BullMQ's Redis 5.0+ requirement cannot be met

type JobHandler = (job: { id: string; data: any }) => Promise<any>;

interface InMemoryJob {
  id: string;
  name: string;
  data: any;
  delay: number;
  addedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class InMemoryQueue {
  name: string;
  private handler: JobHandler | null = null;
  private jobs: Map<string, InMemoryJob> = new Map();
  private processed = 0;
  private failed = 0;

  constructor(name: string) {
    this.name = name;
  }

  async add(name: string, data: any, opts?: { delay?: number; attempts?: number }): Promise<{ id: string }> {
    const id = `memq_${this.name}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const job: InMemoryJob = { id, name, data, delay: opts?.delay || 0, addedAt: Date.now(), timer: null };

    if (opts?.delay && opts.delay > 0) {
      job.timer = setTimeout(() => this.execute(id), opts.delay);
    } else {
      // execute on next tick
      setImmediate(() => this.execute(id));
    }

    this.jobs.set(id, job);
    return { id };
  }

  async getJobCounts(): Promise<{ waiting: number; active: number; completed: number; failed: number }> {
    return {
      waiting: this.jobs.size,
      active: 0,
      completed: this.processed,
      failed: this.failed,
    };
  }

  process(handler: JobHandler) {
    this.handler = handler;
  }

  private async execute(id: string) {
    const job = this.jobs.get(id);
    if (!job || !this.handler) return;

    this.jobs.delete(id);
    try {
      await this.handler({ id: job.id, data: job.data });
      this.processed++;
    } catch (err: any) {
      this.failed++;
      console.error(`[InMemoryQueue:${this.name}] Job ${id} failed:`, err.message);
    }
  }

  async close() {
    for (const [, job] of this.jobs) {
      if (job.timer) clearTimeout(job.timer);
    }
    this.jobs.clear();
    this.handler = null;
  }

  get client() {
    return Promise.resolve({ ping: () => Promise.resolve('PONG') });
  }
}
