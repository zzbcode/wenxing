export const apiBase = `${import.meta.env.BASE_URL}api`;
let csrfToken = "";
export function setCsrf(value) {
  csrfToken = value || "";
}
export async function api(path, { method = "GET", body, signal } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    credentials: "same-origin",
    signal,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "服务器返回了无法读取的响应" }));
  if (!response.ok) {
    const e = new Error(data.error || `请求失败（${response.status}）`);
    e.status = response.status;
    e.data = data;
    throw e;
  }
  return data;
}
export async function generate(body, signal, onEvent) {
  const response = await fetch(`${apiBase}/chat`, {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const d = await response.json().catch(() => ({}));
    throw new Error(d.error || `生成失败（${response.status}）`);
  }
  if (!response.body)
    throw new Error("浏览器未提供流式响应，请更新浏览器后重试");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    completed = false;
  const process = (block) => {
    let event = "message",
      lines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
    }
    if (!lines.length) return;
    const data = JSON.parse(lines.join("\n"));
    if (event === "error") throw new Error(data.error || "生成失败，请重试");
    if (event === "done") completed = true;
    onEvent(event, data);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        process(block);
      }
      if (done) break;
    }
    if (buffer.trim()) process(buffer);
    if (!completed)
      throw new Error("连接提前结束，未完成的内容不会写入正文。请重新生成。");
  } finally {
    reader.releaseLock();
  }
}
