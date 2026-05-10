import { getPipelineJob, subscribePipelineJob } from '@/lib/pipeline-jobs';

export const dynamic = 'force-dynamic';

function isTerminal(status: string) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const job = await getPipelineJob(params.id);
  if (!job) {
    return new Response(JSON.stringify({ error: 'Pipeline job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let keepAlive: ReturnType<typeof setInterval> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }
        try {
          controller.close();
        } catch {
        }
      };

      const send = (nextJob: typeof job) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ job: nextJob })}\n\n`));
      };

      send(job);
      if (isTerminal(job.status)) {
        close();
        return;
      }

      let unsubscribe = () => {};
      unsubscribe = subscribePipelineJob(params.id, (nextJob) => {
        send(nextJob);
        if (isTerminal(nextJob.status)) {
          unsubscribe();
          close();
        }
      });

      keepAlive = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
      }, 15_000);

      const abort = () => {
        unsubscribe();
        close();
      };

      request.signal.addEventListener('abort', abort, { once: true });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
