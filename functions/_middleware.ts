interface MiddlewareContext {
  next: () => Promise<Response>;
}

export const onRequest = async ({ next }: MiddlewareContext): Promise<Response> => {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Request-Id", response.headers.get("X-Request-Id") || crypto.randomUUID());
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
