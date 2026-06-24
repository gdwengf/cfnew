// CF Pages Edge Proxy - Single file worker
// This file is the combined worker for direct Pages deployment
import { connect } from "cloudflare:sockets";

const CONFIG = {
  uuid: "f64bdc57-0f54-4705-bf75-cfd646d98c06",
  wsPath: "/?ed=2048",
};

const HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>EdgeNet CDN</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.card{background:rgba(255,255,255,.95);border-radius:16px;padding:48px;box-shadow:0 20px 60px rgba(0,0,0,.15);max-width:440px;width:90%;text-align:center}.dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:#22c55e;margin-right:8px;box-shadow:0 0 12px rgba(34,197,94,.4);animation:pl 2s ease-in-out infinite}@keyframes pl{0%,100%{opacity:1}50%{opacity:.5}}h1{margin:20px 0 8px;font-size:24px;font-weight:700;color:#2d3748}p{color:#718096;font-size:14px;line-height:1.7;margin:0 0 12px}.meta{font-size:12px;color:#a0aec0;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:12px}.badge{background:#22c55e;color:#fff;border-radius:999px;padding:4px 14px;font-size:12px;font-weight:600;display:inline-block}</style></head><body><div class="card"><div class="badge">ALL SYSTEMS OK</div><h1>EdgeNet CDN</h1><p>Edge infrastructure running nominally.</p><div class="meta">Region: asia-east-1 &middot; v2.4.1</div></div></body></html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket" && url.pathname + url.search === CONFIG.wsPath) {
      return handleWs(request);
    }
    return new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }});
  }
};

async function handleWs(r) {
  const [c, s] = Object.values(new WebSocketPair());
  s.accept();
  s.addEventListener("message", async e => {
    try {
      let b = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : null;
      if (!b || b.length < 18) return;
      let o = 17 + b[17] + 1;
      if (b[o++] !== 1) return;
      const t = b[o++]; let h, p;
      if (t === 1) { h = [...b.slice(o,o+4)].join("."); o+=4; }
      else if (t === 3) { const l = b[o++]; h = new TextDecoder().decode(b.slice(o,o+l)); o+=l; }
      else if (t === 4) { const q=[]; for(let i=0;i<8;i++)q.push(((b[o+i*2]<<8)|b[o+i*2+1]).toString(16)); h=q.join(":"); o+=16; }
      else return;
      p = (b[o]<<8)|b[o+1]; o+=2;
      const socket = await connect({hostname:h, port:p});
      const w = socket.writable.getWriter(); await w.write(b.slice(o)); w.releaseLock();
      const rd = socket.readable.getReader(); const ch = [];
      while (true) { const {done,value} = await rd.read(); if (done) break; ch.push(value); }
      rd.releaseLock();
      const tot = ch.reduce((a,b) => a + b.byteLength, 0); const r2 = new Uint8Array(tot); let x = 0;
      for (const c of ch) { r2.set(c, x); x += c.byteLength; }
      if (r2.length > 0) s.send(r2.buffer);
      s.close(1000, "ok");
    } catch(e) { try { s.close(1011, e.message); } catch(_) {} }
  });
  return new Response(null, { status: 101, webSocket: c });
}
