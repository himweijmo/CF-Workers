// ------------------- Durable Object -------------------
export class SessionObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let url = new URL(request.url);

    // Worker 外层已经把 session=xxx 消费掉，因此这里是干净路径
    // 你实际访问的是：
    // /v2/xxx
    // /fc/gt2/...
    // /fc/gfct/...
    //
    // 所以这里不再处理任何 ?session=
    //
    const targetBase = "https://github-api.arkoselabs.com";
    const targetUrl = targetBase + url.pathname + url.search;

    // 读 Cookie（Arkose 会用）
    let savedCookie = await this.state.storage.get("cookie") || "";

    // 复制请求头
    let headers = new Headers(request.headers);

    // 删除 Cloudflare / Worker 暴露 ID 的头
    [
      "cf-connecting-ip",
      "cf-ray",
      "cf-ew-via",
      "cf-worker",
      "cdn-loop",
      "x-real-ip",
      "x-forwarded-for",
      "x-forwarded-proto",
      "host"
    ].forEach(h => headers.delete(h));

    // 加载持久化 Cookie
    if (savedCookie) {
      headers.set("cookie", savedCookie);
    }

    // 随机 IPv6 防封禁
    const fakeIp = generateIPv6();
    headers.set("X-Forwarded-For", fakeIp);
    headers.set("X-Real-IP", fakeIp);

    // 组装透传请求
    const newReq = new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== "GET" ? request.body : undefined,
      redirect: "manual"
    });

    const resp = await fetch(newReq);

    // 处理 Arkose 的 Set-Cookie
    const setCookie = resp.headers.get("set-cookie");
    if (setCookie) {
      await this.state.storage.put("cookie", mergeCookies(savedCookie, setCookie));
    }

    // 返回原始响应（允许 CORS）
    let respHeaders = new Headers(resp.headers);
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
    const url = new URL(request.url);

    // 处理会话初始化
    let sessionId = url.searchParams.get("session");

    if (sessionId) {
      // 首次调用：只需返回 OK，Python 用来初始化 session
      return new Response("session ok", { status: 200 });
    }

    // 非首次调用，需要从 Header 中拿 session
    sessionId = request.headers.get("X-Session-ID");
    if (!sessionId) {
      return new Response(
        "Missing session id. First request must be ?session=xxx, later requests must send X-Session-ID",
        { status: 400 }
      );
    }

    // 绑定 Durable Object
    let id = env.SESSIONS.idFromName(sessionId);
    let sessionObject = env.SESSIONS.get(id);

    // 把请求转发给 DO（保持 Session）
    return sessionObject.fetch(request);
  }
};

// ------------------- Tools -------------------
function generateIPv6() {
  return Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 0xffff).toString(16)
  ).join(":");
}

function mergeCookies(oldCookie, newCookie) {
  let jar = {};

  function load(str) {
    str.split(";").forEach(pair => {
      const [k, v] = pair.trim().split("=");
      if (k && v) jar[k] = v;
    });
  }

  load(oldCookie);
  load(newCookie);

  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
