/** Validate / normalize video bytes scraped from Google Flow. */

export function normalizeArrayBuffer(data) {
  if (!data) return null;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  if (Array.isArray(data)) return new Uint8Array(data).buffer;

  if (typeof data === "object") {
    const keys = Object.keys(data).filter((k) => /^\d+$/.test(k));
    if (keys.length > 100) {
      const arr = new Uint8Array(keys.length);
      keys
        .sort((a, b) => Number(a) - Number(b))
        .forEach((k, i) => {
          arr[i] = data[k];
        });
      return arr.buffer;
    }
  }

  return null;
}

export function isVideoBuffer(buffer) {
  const buf = normalizeArrayBuffer(buffer);
  if (!buf || buf.byteLength < 256) return false;

  const u = new Uint8Array(buf);

  if (u[0] === 0x1a && u[1] === 0x45 && u[2] === 0xdf && u[3] === 0xa3) return true;
  if (u[0] === 0x47) return true;

  const scanLen = Math.min(u.length, 16384);
  for (let i = 0; i < scanLen - 3; i++) {
    const tag = String.fromCharCode(u[i], u[i + 1], u[i + 2], u[i + 3]);
    if (tag === "ftyp" || tag === "moov" || tag === "mdat" || tag === "free" || tag === "moof") {
      return true;
    }
  }

  return false;
}

export function detectVideoMime(buffer, headerMime) {
  const buf = normalizeArrayBuffer(buffer);
  if (buf) {
    const u = new Uint8Array(buf);
    if (u[0] === 0x1a && u[1] === 0x45) return "video/webm";
    const scanLen = Math.min(u.length, 16384);
    for (let i = 0; i < scanLen - 3; i++) {
      const tag = String.fromCharCode(u[i], u[i + 1], u[i + 2], u[i + 3]);
      if (tag === "ftyp" || tag === "moov" || tag === "mdat") return "video/mp4";
    }
  }
  const h = String(headerMime || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (h.startsWith("video/")) return h;
  return "video/mp4";
}

export function formatByteSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function toAbsoluteFlowUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("blob:") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) return `https://labs.google${trimmed}`;
  try {
    return new URL(trimmed, "https://labs.google/fx/tools/flow").href;
  } catch {
    return null;
  }
}

export function extractMediaUrlFromPayload(payload) {
  const urls = [];

  const walk = (node) => {
    if (!node) return;
    if (typeof node === "string") {
      if (
        node.includes("flow-content.google") ||
        node.includes("googleusercontent.com") ||
        node.includes(".mp4") ||
        node.includes("getMediaUrlRedirect")
      ) {
        urls.push(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "object") {
      for (const value of Object.values(node)) walk(value);
    }
  };

  walk(payload);
  return urls.map(toAbsoluteFlowUrl).find(Boolean) || null;
}
