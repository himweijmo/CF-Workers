export class SessionObject {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");

    if (!target) {
      return new Response("Missing ?url=", { status: 400 });
    }

    // 读取会话 Cookie
    let savedCookie = await this.state.storage.get("cookie") || "";

    // 构建请求
    let init = {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
      redirect: "follow"
    };

    // 覆盖 Cookie
    if (savedCookie) {
      init.headers.set("cookie", savedCookie);
    }

    // 删除可能暴露真实 IP 的 headers
    init.headers.delete("cf-connecting-ip");
    init.headers.delete("x-forwarded-for");
    init.headers.delete("x-real-ip");

    // 不要把 worker 的 host 转发出去
    init.headers.delete("host");

    // 真正发起请求
    let response = await fetch(target, init);

    // 处理 Set-Cookie
    let setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      await this.state.storage.put("cookie", setCookie);
    }

    // 返回响应（保留所有 headers）
    return new Response(response.body, {
      status: response.status,
      headers: response.headers
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

    // 获取 DO 实例
    let id = env.SESSIONS.idFromName(sessionId);
    let session = env.SESSIONS.get(id);

    return session.fetch(request);
  }
};
