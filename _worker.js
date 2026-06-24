// CF Pages Edge Proxy - Bidirectional VLESS+WS
import { connect } from "cloudflare:sockets";

const CFG = {
  uuid: "f64bdc57-0f54-4705-bf75-cfd646d98c06",
  wsPath: "/?ed=2048",
};

const HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>EdgeNet CDN</title><style>body{background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;justify-content:center;align-items:center;margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}.card{background:rgba(255,255,255,.95);border-radius:16px;padding:48px;max-width:440px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.15)}.badge{background:#22c55e;color:#fff;border-radius:999px;padding:4px 14px;font-size:12px;font-weight:600;display:inline-block}h1{margin:20px 0 8px;font-size:24px;font-weight:700;color:#2d3748}p{color:#718096;font-size:14px;line-height:1.7;margin:0 0 12px}.meta{font-size:12px;color:#a0aec0;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:12px}</style></head><body><div class="card"><div class="badge">ALL SYSTEMS OK</div><h1>EdgeNet CDN</h1><p>Edge infrastructure running nominally.</p><div class="meta">Region: asia-east-1 &middot; v2.4.1</div></div></body></html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket" && url.pathname + url.search === CFG.wsPath) {
      return handleUpgrade(request);
    }
    return new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }});
  }
};

async function handleUpgrade(request) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  // Read VLESS header (first message)
  const firstMsg = await new Promise(r => {
    server.addEventListener("message", e => r(e.data), { once: true });
  });
  if (!firstMsg || typeof firstMsg === "string") {
    server.close(1002, "invalid vless header");
    return new Response(null, { status: 101, webSocket: client });
  }

  const buf = new Uint8Array(firstMsg);
  if (buf.length < 18) {
    server.close(1002, "header too short");
    return new Response(null, { status: 101, webSocket: client });
  }

  // Parse VLESS request header
  let o = 16;
  const addonLen = buf[o];
  o += 1 + addonLen;
  if (buf[o++] !== 1) {
    server.close(1002, "not a request");
    return new Response(null, { status: 101, webSocket: client });
  }

  const atype = buf[o++];
  let host;
  if (atype === 1) {
    host = [...buf.slice(o, o+4)].join(".");
    o += 4;
  } else if (atype === 3) {
    const dlen = buf[o++];
    host = new TextDecoder().decode(buf.slice(o, o+dlen));
    o += dlen;
  } else if (atype === 4) {
    const parts = [];
    for (let i = 0; i < 8; i++) {
      parts.push(((buf[o+i*2] << 8) | buf[o+i*2+1]).toString(16));
    }
    host = parts.join(":");
    o += 16;
  } else {
    server.close(1002, "unsupported addr type: " + atype);
    return new Response(null, { status: 101, webSocket: client });
  }

  const port = (buf[o] << 8) | buf[o+1];
  o += 2;

  // Connect to target
  let target;
  try {
    target = await connect({ hostname: host, port });
  } catch (e) {
    server.close(1011, "connect failed: " + host + ":" + port);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Write remaining VLESS payload (actual traffic) to target
  const payload = buf.slice(o);
  const tgtWriter = target.writable.getWriter();
  if (payload.length > 0) await tgtWriter.write(payload);

  // Bidirectional pipe:
  // Direction A: target.readable -> WebSocket.send
  // Direction B: WebSocket messages -> target.writable

  // A: target -> WS
  (async () => {
    const reader = target.readable.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        server.send(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      }
    } catch (e) {}
    try { server.close(1000, "target closed"); } catch (_) {}
  })();

  // B: WS -> target
  server.addEventListener("message", async (e) => {
    try {
      let data = e.data;
      if (typeof data === "string") {
        data = new TextEncoder().encode(data);
      }
      if (data instanceof ArrayBuffer) {
        data = new Uint8Array(data);
      }
      if (tgtWriter) await tgtWriter.write(data);
    } catch (_) {}
  });

  server.addEventListener("close", () => {
    try { tgtWriter.close(); } catch (_) {}
  });
  server.addEventListener("error", () => {
    try { tgtWriter.close(); } catch (_) {}
  });

  return new Response(null, { status: 101, webSocket: client });
}
