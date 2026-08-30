const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-revenuecat-signature',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers },
  });
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...CORS },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
