export class SessionObject {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");
    if (!target) return new Response("Missing ?url=", { status: 400 });

    // 读取旧 Cookies
    let cookie = await this.state.storage.get("cookie") || "";

    let init = {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
    };

    // 覆盖 Cookie
    if (cookie) {
      init.headers.set("cookie", cookie);
    }

    // 不要把 Cloudflare headers 转发出去
    init.headers.delete("cf-connecting-ip");
    init.headers.delete("x-forwarded-for");
    init.headers.delete("x-real-ip");

    let resp = await fetch(target, init);

    // 自动更新 Set-Cookie
    let setCookie = resp.headers.get("set-cookie");
    if (setCookie) {
      await this.state.storage.put("cookie", setCookie);
    }

    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("session");

    if (!sessionId) {
      return new Response("Missing ?session=", { status: 400 });
    }

    // 获取对应会话
    let id = env.SESSIONS.idFromName(sessionId);
    let obj = env.SESSIONS.get(id);

    return obj.fetch(request);
  }
};
