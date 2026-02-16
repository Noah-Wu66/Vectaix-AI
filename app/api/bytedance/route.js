import { POST as openaiPOST, runtime, dynamic } from '@/app/api/openai/route';

export { runtime, dynamic };

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  const model = typeof body?.model === 'string' ? body.model.trim() : '';
  const normalizedModel = model && model.includes('/') ? model : model ? `volcengine/${model}` : model;

  const forwardReq = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify({ ...body, model: normalizedModel }),
    signal: req.signal,
  });

  return openaiPOST(forwardReq);
}
