// ------------------- Durable Object (per-session storage) -------------------
export class SessionObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Target Arkose API
    const target = "https://github-api.arkoselabs.com";
    const targetUrl = target + url.pathname + url.search;

    // Load cookies for this session
    let cookies = await this.state.storage.get("cookie") || "";

    // Clone headers
    const headers = new Headers(request.headers);

    // Remove Cloudflare headers
    [
      "cf-connecting-ip", "cf-ray", "cf-ew-via",
      "cf-worker", "cdn-loop",
      "x-real-ip", "x-forwarded-for", "x-forwarded-proto",
      "host"
    ].forEach(h => headers.delete(h));

    // Inject Cookie
    if (cookies) {
      headers.set("cookie", cookies);
    }

    // Random IPv6 spoofing
    const fakeIp = generateIPv6();
    headers.set("X-Forwarded-For", fakeIp);
    headers.set("X-Real-IP", fakeIp);

    // Forward request
    const newReq = new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== "GET" ? request.body : undefined,
      redirect: "manual"
    });

    const resp = await fetch(newReq);

    // Save Set-Cookie from Arkose
    const setCookie = resp.headers.get("set-cookie");
    if (setCookie) {
      cookies = mergeCookies(cookies, setCookie);
      await this.state.storage.put("cookie", cookies);
    }

    // CORS
    const respHeaders = new Headers(resp.headers);
    respHeaders.set("access-control-allow-origin", "*");
    respHeaders.set("access-control-allow-credentials", "true");

    return new Response(resp.body, {
      status: resp.status,
      headers: respHeaders
    });
  }
}

// ------------------- Worker Router (session via headers) -------------------
export default {
  async fetch(request, env) {
    // MUST send: X-Session-ID
    const sessionId = request.headers.get("X-Session-ID");

    if (!sessionId) {
      return new Response("Missing X-Session-ID", { status: 400 });
    }

    // Create / get Durable Object instance
    const id = env.SESSIONS.idFromName(sessionId);
    const session = env.SESSIONS.get(id);

    // Forward to DO
    return session.fetch(request);
  }
};

// ------------------- Utilities -------------------
function generateIPv6() {
  return [...Array(8)]
    .map(() => Math.floor(Math.random() * 0xffff).toString(16))
    .join(":");
}

function mergeCookies(oldCookies, newCookies) {
  let jar = {};
  function parse(str) {
    str.split(";").forEach(pair => {
      const [k, v] = pair.trim().split("=");
      if (k && v) jar[k] = v;
    });
  }
  parse(oldCookies);
  parse(newCookies);

  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
