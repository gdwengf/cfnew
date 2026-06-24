// CF Edge Proxy - obfuscated for CF Pages
// Config - change these
const CONFIG = {
  uuid: 'f64bdc57-0f54-4705-bf75-cfd646d98c06',
  wsPath: '/?ed=2048',
};

// Fake landing page (looks like EdgeNet CDN status)
const LANDING = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>EdgeNet CDN</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.card{background:rgba(255,255,255,.95);border-radius:16px;padding:48px;box-shadow:0 20px 60px rgba(0,0,0,.15);max-width:440px;width:90%;text-align:center}.dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:#22c55e;margin-right:8px;box-shadow:0 0 12px rgba(34,197,94,.4);animation:pl 2s ease-in-out infinite}@keyframes pl{0%,100%{opacity:1}50%{opacity:.5}}h1{margin:20px 0 8px;font-size:24px;font-weight:700;color:#2d3748}p{color:#718096;font-size:14px;line-height:1.7;margin:0 0 12px}.meta{font-size:12px;color:#a0aec0;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:12px}.badge{background:#22c55e;color:#fff;border-radius:999px;padding:4px 14px;font-size:12px;font-weight:600;letter-spacing:.5px;display:inline-block}</style></head><body><div class="card"><div class="badge">ALL SYSTEMS OK</div><h1>EdgeNet CDN</h1><p>Edge compute infrastructure running nominally.</p><div class="meta">Region: asia-east-1 &middot; v2.4.1 &middot; 99.97% uptime</div></div></body></html>';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const t = new URL(CONFIG.wsPath, "http://x");
      if (url.pathname === t.pathname && url.search === t.search) {
        return handleWs(request);
      }
    }
    
    return new Response(LANDING, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
    });
  }
};

async function handleWs(request) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  
  server.addEventListener("message", async (e) => {
    try {
      const raw = e.data;
      let buf = raw instanceof ArrayBuffer ? new Uint8Array(raw) :
                raw?.buffer instanceof ArrayBuffer ? new Uint8Array(raw.buffer) : null;
      if (!buf || buf.length < 18) return;
      
      const rx = bytesToHex(buf.slice(1, 17));
      if (rx !== CONFIG.uuid.replace(/-/g, "")) {
        server.close(1008, "auth failed");
        return;
      }
      
      let off = 17 + buf[17] + 1;
      if (buf[off++] !== 1) return;
      
      const at = buf[off++];
      let host, port;
      if (at === 1) { host = [...buf.slice(off, off+4)].join("."); off += 4; }
      else if (at === 3) { const l = buf[off++]; host = new TextDecoder().decode(buf.slice(off, off+l)); off += l; }
      else if (at === 4) { const p=[]; for(let i=0;i<8;i++)p.push(((buf[off+i*2]<<8)|buf[off+i*2+1]).toString(16)); host=p.join(":"); off+=16; }
      else return;
      
      port = (buf[off] << 8) | buf[off + 1]; off += 2;
      const payload = buf.slice(off);
      
      try {
        const socket = await connect({ hostname: host, port: port });
        const writer = socket.writable.getWriter();
        await writer.write(payload);
        writer.releaseLock();
        
        const reader = socket.readable.getReader();
        const chunks = [];
        while (true) { const {done,value} = await reader.read(); if (done) break; chunks.push(value); }
        reader.releaseLock();
        
        const total = chunks.reduce((a,b) => a + b.byteLength, 0);
        const r = new Uint8Array(total);
        let o = 0;
        for (const c of chunks) { r.set(c, o); o += c.byteLength; }
        if (r.length > 0) server.send(r.buffer);
        server.close(1000, "ok");
      } catch (e) {
        server.close(1011, e.message);
      }
    } catch (e) {
      try { server.close(1011, "err"); } catch (_) {}
    }
  });
  
  return new Response(null, { status: 101, webSocket: client });
}

function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
