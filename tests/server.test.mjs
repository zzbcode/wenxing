import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../server/app.mjs";
import { createUser } from "../server/db.mjs";

async function fixture(options = {}) {
  const upstreamRequests = [];
  const provider = createServer(async (req, res) => {
    let input = "";
    for await (const chunk of req) input += chunk;
    const body = JSON.parse(input);
    upstreamRequests.push(body);
    if (body.messages.at(-1).content === "FAIL") {
      res.writeHead(503);
      res.end("private provider secret");
      return;
    }
    if (body.messages.at(-1).content === "WAIT") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"未完成"}}]}\n\n');
      req.on("close", () => {});
      const timer = setTimeout(() => res.end(), 10000);
      res.on("close", () => clearTimeout(timer));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"门外传来脚步。"}}]}\n\n');
    res.end(
      'data: {"choices":[{"delta":{"content":"沈砚没有回头。"},"finish_reason":"stop"}],"usage":{"prompt_tokens":123,"completion_tokens":12}}\n\ndata: [DONE]\n\n',
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const app = createApp({
    dbPath: ":memory:",
    basePath: "/wenxing",
    secureCookies: false,
    apiKey: "test-key-not-public",
    baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
    ...options,
  });
  createUser(app.locals.db, {
    username: "alice",
    password: "alice-test-password",
  });
  createUser(app.locals.db, { username: "bob", password: "bob-test-password" });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/wenxing/api`;
  async function login(name) {
    const r = await fetch(`${base}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: name,
        password: `${name}-test-password`,
      }),
    });
    const data = await r.json();
    assert.equal(r.status, 200);
    return {
      cookie: r.headers.get("set-cookie").split(";")[0],
      csrf: data.csrfToken,
    };
  }
  const alice = await login("alice"),
    bob = await login("bob");
  async function request(user, path, method = "GET", body) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(user ? { cookie: user.cookie, "X-CSRF-Token": user.csrf } : {}),
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  }
  async function book(user = alice, title = "雁回长安") {
    const {
      data: { project },
    } = await request(user, "/projects", "POST", {
      title,
      synopsis: "合成测试故事",
    });
    const {
      data: { chapter },
    } = await request(user, "/chapters", "POST", {
      projectId: project.id,
      title: "雨入长安",
      content: "原稿。",
    });
    const {
      data: { conversation },
    } = await request(user, "/conversations", "POST", {
      projectId: project.id,
    });
    return { project, chapter, conversation };
  }
  async function chat(user, book, body = {}) {
    const r = await fetch(`${base}/chat`, {
      method: "POST",
      headers: {
        cookie: user.cookie,
        "X-CSRF-Token": user.csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: book.conversation.id,
        chapterId: book.chapter.id,
        prompt: "续写",
        mode: "draft",
        ...body,
      }),
    });
    const raw = await r.text();
    const events = raw
      .split("\n\n")
      .filter((x) => x.startsWith("event:"))
      .map((x) => ({
        event: x.split("\n")[0].slice(7),
        data: JSON.parse(x.split("\n")[1].slice(6)),
      }));
    return { status: r.status, events, raw };
  }
  return {
    app,
    base,
    alice,
    bob,
    request,
    book,
    chat,
    upstreamRequests,
    close: async () => {
      server.closeAllConnections();
      provider.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => server.close(resolve)),
        new Promise((resolve) => provider.close(resolve)),
      ]);
      app.locals.db.close();
    },
  };
}

test("authentication, CSRF, session secrecy and origin protection", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request(null, "/bootstrap")).status, 401);
    const session = await f.request(f.alice, "/session");
    assert.equal(session.data.user.username, "alice");
    assert.equal(session.data.modelCapabilities.contextVerified, false);
    assert.equal(session.data.modelCapabilities.contextLimit, null);
    assert.ok(!JSON.stringify(session.data).includes("test-key"));
    const missing = await fetch(`${f.base}/projects`, {
      method: "POST",
      headers: { cookie: f.alice.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "书" }),
    });
    assert.equal(missing.status, 403);
    const cross = await fetch(`${f.base}/projects`, {
      method: "POST",
      headers: {
        cookie: f.alice.cookie,
        "X-CSRF-Token": f.alice.csrf,
        Origin: "https://attacker.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "书" }),
    });
    assert.equal(cross.status, 403);
    await f.request(f.alice, "/logout", "POST", {});
    assert.equal((await f.request(f.alice, "/bootstrap")).status, 401);
  } finally {
    await f.close();
  }
});

test("owner isolation across edits, context, conversation, history and adoption", async () => {
  const f = await fixture();
  try {
    const a = await f.book(),
      b = await f.book(f.bob, "另一位作者");
    assert.equal(
      (
        await f.request(f.bob, `/chapters/${a.chapter.id}`, "PATCH", {
          content: "侵入",
          expectedRevision: 1,
        })
      ).status,
      404,
    );
    assert.equal(
      (await f.request(f.bob, `/chapters/${a.chapter.id}/history`)).status,
      404,
    );
    assert.equal(
      (
        await f.request(f.bob, "/conversations", "POST", {
          projectId: a.project.id,
        })
      ).status,
      404,
    );
    assert.equal((await f.chat(f.bob, a)).status, 404);
    assert.equal(
      (await f.chat(f.alice, a, { referenceChapterIds: [b.chapter.id] }))
        .status,
      400,
    );
    const response = await f.chat(f.alice, a);
    const message = response.events.find((x) => x.event === "done").data
      .assistantMessage;
    assert.equal(
      (
        await f.request(f.bob, "/chapters/append", "POST", {
          chapterId: b.chapter.id,
          messageId: message.id,
          expectedRevision: 1,
        })
      ).status,
      404,
    );
    const other = await f.book(f.alice, "同作者另一本书");
    assert.equal(
      (
        await f.request(f.alice, "/chapters/append", "POST", {
          chapterId: other.chapter.id,
          messageId: message.id,
          expectedRevision: 1,
        })
      ).status,
      404,
    );
    const bootstrap = await f.request(f.bob, "/bootstrap");
    assert.equal(bootstrap.data.projects.length, 1);
    assert.equal(bootstrap.data.messages.length, 0);
  } finally {
    await f.close();
  }
});

test("revision conflicts, explicit idempotent adoption, snapshots and restore", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const generated = await f.chat(f.alice, book);
    assert.equal(generated.status, 200);
    const done = generated.events.find((x) => x.event === "done").data;
    assert.equal(done.autoInsert, false);
    assert.equal(
      (await f.request(f.alice, "/bootstrap")).data.chapters[0].content,
      "原稿。",
    );
    const adopted = await f.request(f.alice, "/chapters/append", "POST", {
      chapterId: book.chapter.id,
      messageId: done.assistantMessage.id,
      expectedRevision: 1,
    });
    assert.equal(adopted.status, 200);
    assert.equal(adopted.data.chapter.revision, 2);
    assert.match(adopted.data.chapter.content, /脚步/);
    const twice = await f.request(f.alice, "/chapters/append", "POST", {
      chapterId: book.chapter.id,
      messageId: done.assistantMessage.id,
      expectedRevision: 1,
    });
    assert.equal(twice.status, 200);
    assert.equal(twice.data.alreadyInserted, true);
    assert.equal(twice.data.chapter.revision, 2);
    const conflict = await f.request(
      f.alice,
      `/chapters/${book.chapter.id}`,
      "PATCH",
      { content: "旧稿覆盖", expectedRevision: 1 },
    );
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.chapter.revision, 2);
    const history = await f.request(
      f.alice,
      `/chapters/${book.chapter.id}/history`,
    );
    assert.equal(history.data.history[0].content, "原稿。");
    const restored = await f.request(
      f.alice,
      `/chapters/${book.chapter.id}/restore`,
      "POST",
      { revisionId: history.data.history[0].id, expectedRevision: 2 },
    );
    assert.equal(restored.data.chapter.content, "原稿。");
    assert.equal(restored.data.chapter.revision, 3);
  } finally {
    await f.close();
  }
});

test("outline approval and exact branch/context use, logs contain metadata only", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const outline = await f.chat(f.alice, book, {
      mode: "outline",
      prompt: "列大纲",
      parentId: null,
      referenceChapterIds: [],
    });
    const outlineMsg = outline.events.find((x) => x.event === "done").data
      .assistantMessage;
    const approved = await f.request(f.alice, "/workflow", "PATCH", {
      conversationId: book.conversation.id,
      messageId: outlineMsg.id,
      action: "approve",
    });
    assert.equal(approved.status, 200);
    const draft = await f.chat(f.alice, book, { prompt: "依据大纲写" });
    const draftMsg = draft.events.find((x) => x.event === "done").data
      .assistantMessage;
    assert.equal(
      (
        await f.request(f.alice, "/workflow", "PATCH", {
          conversationId: book.conversation.id,
          messageId: draftMsg.id,
          action: "approve",
        })
      ).status,
      400,
    );
    await f.chat(f.alice, book, {
      prompt: "从零分支",
      parentId: null,
      referenceChapterIds: [],
    });
    const last = f.upstreamRequests.at(-1);
    assert.equal(last.messages.length, 2);
    assert.ok(!last.messages[0].content.includes("原稿。"));
    await f.chat(f.alice, book, {
      prompt: "按当前章",
      parentId: outlineMsg.id,
      referenceChapterIds: [book.chapter.id],
    });
    assert.equal(f.upstreamRequests.at(-1).messages.length, 4);
    assert.match(f.upstreamRequests.at(-1).messages[0].content, /原稿/);
    const logs = await f.request(f.alice, "/request-history");
    assert.ok(logs.data.logs[0].promptBytes > 0);
    assert.ok(!JSON.stringify(logs).includes("依据大纲写"));
    assert.ok(!JSON.stringify(logs).includes("Bearer"));
  } finally {
    await f.close();
  }
});

test("safe budget enforcement and upstream errors never alter manuscript", async () => {
  const f = await fixture({ requestTokenBudget: 4096 });
  try {
    const book = await f.book();
    await f.request(f.alice, "/settings", "PATCH", { maxTokens: 256 });
    const tooLarge = await f.chat(f.alice, book, { prompt: "大".repeat(2000) });
    assert.equal(tooLarge.status, 413);
    assert.equal(f.upstreamRequests.length, 0);
    const failed = await f.chat(f.alice, book, { prompt: "FAIL" });
    assert.ok(failed.events.some((x) => x.event === "error"));
    assert.ok(!failed.raw.includes("private provider secret"));
    assert.equal(
      (await f.request(f.alice, "/bootstrap")).data.chapters[0].content,
      "原稿。",
    );
  } finally {
    await f.close();
  }
});

test("cancelling response stops upstream work and leaves no completed candidate", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const abort = new AbortController();
    const response = await fetch(`${f.base}/chat`, {
      method: "POST",
      headers: {
        cookie: f.alice.cookie,
        "X-CSRF-Token": f.alice.csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: book.conversation.id,
        chapterId: book.chapter.id,
        prompt: "WAIT",
      }),
      signal: abort.signal,
    });
    const reader = response.body.getReader();
    await reader.read();
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const logs = await f.request(f.alice, "/request-history");
    assert.equal(logs.data.logs[0].status, "cancelled");
    const data = (await f.request(f.alice, "/bootstrap")).data;
    assert.equal(data.messages.filter((x) => x.role === "assistant").length, 0);
    assert.equal(data.chapters[0].content, "原稿。");
  } finally {
    await f.close();
  }
});

test("overlapping generation is rejected without clearing the first request lock", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const abort = new AbortController();
    const response = await fetch(`${f.base}/chat`, {
      method: "POST",
      headers: {
        cookie: f.alice.cookie,
        "X-CSRF-Token": f.alice.csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: book.conversation.id,
        chapterId: book.chapter.id,
        prompt: "WAIT",
      }),
      signal: abort.signal,
    });
    const reader = response.body.getReader();
    await reader.read();
    assert.equal(
      (await f.chat(f.alice, book, { prompt: "第二次" })).status,
      409,
    );
    assert.equal(
      (await f.chat(f.alice, book, { prompt: "第三次" })).status,
      409,
    );
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      (await f.chat(f.alice, book, { prompt: "取消后恢复" })).status,
      200,
    );
  } finally {
    await f.close();
  }
});

test("concurrent chapter edits preserve winner and cannot silently overwrite", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const results = await Promise.all(
      ["稿件甲", "稿件乙"].map((content) =>
        f.request(f.alice, `/chapters/${book.chapter.id}`, "PATCH", {
          content,
          expectedRevision: 1,
        }),
      ),
    );
    assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
    const saved = (await f.request(f.alice, "/bootstrap")).data.chapters[0];
    assert.equal(saved.revision, 2);
    assert.equal(
      saved.content,
      results.find((x) => x.status === 200).data.chapter.content,
    );
  } finally {
    await f.close();
  }
});

test("database persists account, manuscript and candidate across reopen", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const folder = mkdtempSync(join(tmpdir(), "wenxing-test-"));
  const dbPath = join(folder, "db.sqlite");
  const f = await fixture({ dbPath });
  let reopened;
  try {
    const book = await f.book();
    await f.chat(f.alice, book);
    await f.close();
    reopened = createApp({ dbPath, basePath: "/wenxing" });
    assert.equal(
      reopened.locals.db.prepare("SELECT count(*) AS n FROM users").get().n,
      2,
    );
    assert.equal(
      reopened.locals.db
        .prepare("SELECT content FROM chapters WHERE id=?")
        .get(book.chapter.id).content,
      "原稿。",
    );
    assert.equal(
      reopened.locals.db
        .prepare("SELECT count(*) AS n FROM messages WHERE role='assistant'")
        .get().n,
      1,
    );
  } finally {
    reopened?.locals.db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("project settings are owner isolated and only sent when explicitly included", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const changed = await f.request(
      f.alice,
      `/projects/${book.project.id}`,
      "PATCH",
      { settings: "人物暗号：寒鸦九号", synopsis: "梗概暗号：雁门三封信" },
    );
    assert.equal(changed.status, 200);
    assert.equal(changed.data.project.settings, "人物暗号：寒鸦九号");
    assert.equal(
      (
        await f.request(f.bob, `/projects/${book.project.id}`, "PATCH", {
          settings: "入侵",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(f.alice, `/projects/${book.project.id}`, "PATCH", {
          settings: "字".repeat(50001),
        })
      ).status,
      400,
    );
    const excluded = await f.chat(f.alice, book, {
      parentId: null,
      referenceChapterIds: [],
      includeSettings: false,
    });
    assert.equal(excluded.status, 200);
    const excludedContext = f.upstreamRequests.at(-1).messages[0].content;
    assert.ok(!excludedContext.includes("寒鸦九号"));
    assert.ok(!excludedContext.includes("雁门三封信"));
    assert.ok(excludedContext.includes(book.project.title));
    assert.equal(
      excluded.events.find((x) => x.event === "start").data.includeSettings,
      false,
    );
    await f.chat(f.alice, book, {
      parentId: null,
      referenceChapterIds: [],
      includeSettings: true,
    });
    const includedContext = f.upstreamRequests.at(-1).messages[0].content;
    assert.ok(includedContext.includes("寒鸦九号"));
    assert.ok(includedContext.includes("雁门三封信"));
    assert.equal(
      (await f.request(f.alice, "/bootstrap")).data.projects[0].settings,
      "人物暗号：寒鸦九号",
    );
    assert.equal(
      (await f.request(f.bob, "/bootstrap")).data.projects.length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("saving and adopting retain original trailing manuscript whitespace", async () => {
  const f = await fixture();
  try {
    const book = await f.book();
    const manuscript = "开头缩进保留。  \n\n末段。  \n";
    const saved = await f.request(
      f.alice,
      `/chapters/${book.chapter.id}`,
      "PATCH",
      { content: manuscript, expectedRevision: 1 },
    );
    assert.equal(saved.data.chapter.content, manuscript);
    const generated = await f.chat(f.alice, book);
    const message = generated.events.find((x) => x.event === "done").data
      .assistantMessage;
    const adopted = await f.request(f.alice, "/chapters/append", "POST", {
      chapterId: book.chapter.id,
      messageId: message.id,
      expectedRevision: 2,
    });
    assert.ok(adopted.data.chapter.content.startsWith(manuscript + "\n\n"));
    const history = (
      await f.request(f.alice, `/chapters/${book.chapter.id}/history`)
    ).data.history;
    assert.equal(history[0].content, manuscript);
  } finally {
    await f.close();
  }
});

test("existing database migration adds project settings without losing manuscripts", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { openDatabase } = await import("../server/db.mjs");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const folder = mkdtempSync(join(tmpdir(), "wenxing-migration-"));
  const path = join(folder, "db.sqlite");
  let db = new DatabaseSync(path);
  try {
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,ownerId TEXT,title TEXT,synopsis TEXT,genre TEXT,createdAt INTEGER,updatedAt INTEGER); INSERT INTO projects VALUES('old','owner','旧书','旧梗概','历史',1,1)",
    );
    db.close();
    db = openDatabase(path);
    const project = db.prepare("SELECT * FROM projects WHERE id='old'").get();
    assert.equal(project.title, "旧书");
    assert.equal(project.synopsis, "旧梗概");
    assert.equal(project.settings, "");
    db.close();
    db = openDatabase(path);
    assert.equal(
      db
        .prepare("PRAGMA table_info(projects)")
        .all()
        .filter((c) => c.name === "settings").length,
      1,
    );
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
