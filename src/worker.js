// ------------------- Durable Object (per-session) -------------------
export class SessionObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // --------------------
    // Build correct Arkose URL
    // --------------------
    const target = "https://github-api.arkoselabs.com";
    const path = url.pathname.startsWith("/") ? url.pathname : "/" + url.pathname;
    const targetUrl = target + path + url.search;

    // --------------------
    // Load session storage
    // --------------------
    let cookies = await this.state.storage.get("cookie") || "";
    let fakeIp = await this.state.storage.get("fake-ip");

    // Create fake IPv6 if not exists
    if (!fakeIp) {
      fakeIp = generateIPv6();
      await this.state.storage.put("fake-ip", fakeIp);
    }

    // --------------------
    // Clone / sanitize headers
    // --------------------
    const headers = new Headers(request.headers);

    [
      "cf-connecting-ip", "cf-ray", "cf-ew-via",
      "cf-worker", "cdn-loop", "host",
      "x-real-ip", "x-forwarded-for", "x-forwarded-proto"
    ].forEach(h => headers.delete(h));

    // Inject fake IP (Arkose requires this to match session)
    headers.set("X-Forwarded-For", fakeIp);
    headers.set("X-Real-IP", fakeIp);

    // Inject cookie
    if (cookies) {
      headers.set("cookie", cookies);
    }

    // --------------------
    // Forward request
    // --------------------
    const newReq = new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== "GET" ? request.body : undefined,
      redirect: "manual"
    });

    const resp = await fetch(newReq);

    // --------------------
    // Save Set-Cookie from Arkose
    // --------------------
    const setCookie = resp.headers.get("set-cookie");
    if (setCookie) {
      cookies = mergeCookies(cookies, setCookie);
      await this.state.storage.put("cookie", cookies);
    }

    // --------------------
    // CORS
    // --------------------
    const respHeaders = new Headers(resp.headers);
    respHeaders.set("access-control-allow-origin", "*");
    respHeaders.set("access-control-allow-credentials", "true");

    return new Response(resp.body, {
      status: resp.status,
      headers: respHeaders
    });
  }
}

// ------------------- Worker Router -------------------
export default {
  async fetch(request, env) {
    const sessionId = request.headers.get("X-Session-ID");

    if (!sessionId) {
      return new Response("Missing X-Session-ID", { status: 400 });
    }

    const id = env.SESSIONS.idFromName(sessionId);
    const session = env.SESSIONS.get(id);

    return session.fetch(request);
  }
};


// ------------------- Utils -------------------
function generateIPv6() {
  return [...Array(8)]
    .map(() => Math.floor(Math.random() * 0xffff).toString(16))
    .join(":");
}

function mergeCookies(oldCookies, newCookies) {
  const jar = {};

  function add(str) {
    str.split(";").forEach(p => {
      const [k, v] = p.trim().split("=");
      if (k && v) jar[k] = v;
    });
  }

  add(oldCookies);
  add(newCookies);

  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
