import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ClockCounterClockwise,
  DownloadSimple,
  GearSix,
  List,
  Plus,
  SignIn,
  SignOut,
  X,
  WarningCircle,
  PencilSimple,
  Stop,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { api, generate, setCsrf } from "./api";
import { GuestWorkspace, readLocalDraft } from "./GuestWorkspace";
const emptyData = {
  projects: [],
  chapters: [],
  conversations: [],
  messages: [],
  settings: {},
};
const emptyEditor = {
  id: "",
  title: "",
  content: "",
  revision: 0,
  dirty: false,
};
import "@fontsource/noto-serif-sc/400.css";
import "@fontsource/noto-serif-sc/500.css";
const modeNames = {
  draft: "续写",
  outline: "构思大纲",
  rewrite: "改写",
  analyze: "审稿",
  chat: "聊聊故事",
};
const stamp = `${import.meta.env.BASE_URL}assets/wen-seal.png`;
const count = (s) => [...(s || "").replace(/\s/g, "")].length;
const date = (v) =>
  new Date(v).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
function download(name, text, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Dialog({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => {
      if (el.open) el.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button className="icon" onClick={onClose} aria-label="关闭">
          <X size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
function AutoText({ value, ...props }) {
  return (
    <div className="editor-wrap">
      <div className="editor-mirror prose" aria-hidden="true">
        {value + "\n"}
      </div>
      <textarea {...props} value={value} />
    </div>
  );
}

export function App() {
  const [data, setData] = useState(emptyData),
    [user, setUser] = useState(null),
    [ready, setReady] = useState(false),
    [model, setModel] = useState(null),
    [online, setOnline] = useState(true);
  const [projectId, setProjectId] = useState(""),
    [chapterId, setChapterId] = useState(""),
    [threadId, setThreadId] = useState("");
  const [editor, setEditor] = useState({
      ...emptyEditor,
      dirty: false,
    }),
    editorRef = useRef(editor),
    saveLock = useRef(null),
    saveStatus = useRef("saved");
  const [mutating, setMutating] = useState(false),
    operationRef = useRef(false);
  const [saveState, setSaveState] = useState("saved"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [panel, setPanel] = useState(null),
    [focus, setFocus] = useState(true),
    [mode, setMode] = useState("draft");
  const [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [stream, setStream] = useState(""),
    [previewId, setPreviewId] = useState(null),
    [parentId, setParentId] = useState(null),
    abortRef = useRef(null);
  const [referenceIds, setReferenceIds] = useState([]),
    [useSettings, setUseSettings] = useState(true),
    [history, setHistory] = useState([]),
    [logs, setLogs] = useState([]),
    [mobileAssistant, setMobileAssistant] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [createType, setCreateType] = useState("project"),
    [newTitle, setNewTitle] = useState(""),
    [metadata, setMetadata] = useState({}),
    [settings, setSettings] = useState({});
  const [firstChapterTitle, setFirstChapterTitle] = useState("第一章");
  const [includeLocalDraft, setIncludeLocalDraft] = useState(false);
  const [hideLocalOffer, setHideLocalOffer] = useState(false);
  const [localDraft, setLocalDraft] = useState(readLocalDraft);
  const [localDraftUnsaved, setLocalDraftUnsaved] = useState(false);
  const localDraftRisk = useRef(false);
  function trackLocalPersistence(saved) {
    setLocalDraftUnsaved(!saved);
    localDraftRisk.current = !saved;
  }
  const hasLocalDraft = Boolean(localDraft.title || localDraft.content);
  const mounted = useRef(true);
  const isGuest = !user,
    project = data.projects.find((p) => p.id === projectId),
    chapters = data.chapters
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    thread = data.conversations.find((t) => t.id === threadId),
    messages = data.messages.filter((m) => m.conversationId === threadId),
    preview = data.messages.find((m) => m.id === previewId),
    chapterIndex = chapters.findIndex((c) => c.id === chapterId);
  const updateEditor = (v) => {
    editorRef.current = typeof v === "function" ? v(editorRef.current) : v;
    setEditor(editorRef.current);
  };
  const setSaved = (v) => {
    saveStatus.current = v;
    setSaveState(v);
  };
  const patchData = (key, item) =>
    setData((d) => ({
      ...d,
      [key]: d[key].some((x) => x.id === item.id)
        ? d[key].map((x) => (x.id === item.id ? { ...x, ...item } : x))
        : [...d[key], item],
    }));
  const inform = (msg) => setNotice(msg);
  async function load({ preserve = false, preferred } = {}) {
    const d = await api("/bootstrap");
    if (!mounted.current) return;
    setData(d);
    setSettings(d.settings || {});
    if (d.modelCapabilities) setModel(d.modelCapabilities);
    if (!preserve) {
      const p = d.projects.find((x) => x.id === preferred) || d.projects[0];
      const c = d.chapters.find((x) => x.projectId === p?.id);
      const t = d.conversations.find((x) => x.projectId === p?.id);
      setProjectId(p?.id || "");
      setChapterId(c?.id || "");
      setThreadId(t?.id || "");
      updateEditor(
        c
          ? { ...c, dirty: false }
          : { id: "", title: "", content: "", revision: 0, dirty: false },
      );
      setReferenceIds(c ? [c.id] : []);
      setPreviewId(null);
      setParentId(null);
    }
    return d;
  }
  useEffect(() => {
    mounted.current = true;
    api("/session")
      .then(async (s) => {
        if (!mounted.current) return;
        setCsrf(s.csrfToken);
        setModel(s.modelCapabilities);
        if (s.user) await load();
        setUser(s.user);
      })
      .catch(() => setOnline(false))
      .finally(() => {
        if (mounted.current) setReady(true);
      });
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    const h = (e) => {
      if (editorRef.current.dirty || localDraftRisk.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
  useEffect(() => {
    if (
      !editor.dirty ||
      isGuest ||
      ["conflict", "error"].includes(saveStatus.current)
    )
      return;
    const timer = setTimeout(() => save(), 900);
    return () => clearTimeout(timer);
  }, [editor.content, editor.title, editor.dirty, user]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const fn = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !panel) {
        e.preventDefault();
        document.getElementById("assistant-form")?.requestSubmit();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  });
  async function save() {
    if (isGuest || !editorRef.current.id || !editorRef.current.dirty)
      return true;
    if (saveLock.current) {
      const ok = await saveLock.current;
      return ok && editorRef.current.dirty ? save() : ok;
    }
    const snapshot = { ...editorRef.current };
    setSaved("saving");
    const job = (async () => {
      try {
        const r = await api(`/chapters/${snapshot.id}`, {
          method: "PATCH",
          body: {
            title: snapshot.title,
            content: snapshot.content,
            expectedRevision: snapshot.revision,
          },
        });
        const c = r.chapter || r;
        patchData("chapters", c);
        if (editorRef.current.id === c.id) {
          const unchanged =
            editorRef.current.title === snapshot.title &&
            editorRef.current.content === snapshot.content;
          updateEditor({
            ...editorRef.current,
            revision: c.revision,
            dirty: !unchanged,
          });
        }
        setSaved("saved");
        return true;
      } catch (e) {
        setSaved(e.status === 409 ? "conflict" : "error");
        setError(
          e.status === 409
            ? "另一处已修改了这一章。本地文字仍保留，请先导出本地稿，再从历史中核对服务器版本。"
            : `保存失败：${e.message}。文字仍保留在当前页面。`,
        );
        return false;
      } finally {
        saveLock.current = null;
      }
    })();
    saveLock.current = job;
    const ok = await job;
    return ok && editorRef.current.dirty ? save() : ok;
  }
  async function switchChapter(c, p = projectId) {
    if (busy || operationRef.current) {
      inform("请等待当前操作完成。");
      return;
    }
    operationRef.current = true;
    setMutating(true);
    try {
      if (!(await save())) return;
      let target = c;
      if (c?.id === editorRef.current.id) target = { ...editorRef.current };
      else if (!isGuest && c) {
        const fresh = await api("/bootstrap");
        setData(fresh);
        target = fresh.chapters.find((x) => x.id === c.id);
        if (!target) throw new Error("目标章节已变化，请重新打开目录。");
      }
      setChapterId(target?.id || "");
      setProjectId(p);
      updateEditor(
        target
          ? { ...target, dirty: false }
          : { id: "", title: "", content: "", revision: 0, dirty: false },
      );
      setSaved("saved");
      setPreviewId(null);
      setParentId(null);
      setReferenceIds(target ? [target.id] : []);
      const t = data.conversations.find((t) => t.projectId === p);
      setThreadId(t?.id || "");
      setPanel(null);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      operationRef.current = false;
      setMutating(false);
    }
  }
  function requireUser() {
    if (isGuest) {
      setPanel("login");
      return false;
    }
    return true;
  }
  async function login(e) {
    e.preventDefault();
    setError("");
    setLoginBusy(true);
    try {
      const s = await api("/login", {
        method: "POST",
        body: { username, password },
      });
      setCsrf(s.csrfToken);
      setPassword("");
      await load();
      setUser(s.user);
      setPanel(null);
      setOnline(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoginBusy(false);
    }
  }
  async function logout() {
    if (busy || operationRef.current) {
      inform("请先等待当前操作完成。");
      return;
    }
    operationRef.current = true;
    setMutating(true);
    try {
      if (!(await save())) return;
      await api("/logout", { method: "POST", body: {} });
      setCsrf("");
      setUser(null);
      setData(emptyData);
      setProjectId("");
      setChapterId("");
      setThreadId("");
      updateEditor({ ...emptyEditor, dirty: false });
      setPreviewId(null);
      setReferenceIds([]);
      setPanel(null);
      setParentId(null);
    } catch (e) {
      setError(e.message);
    } finally {
      operationRef.current = false;
      setMutating(false);
    }
  }
  async function run(e) {
    e?.preventDefault();
    if (!requireUser() || busy || operationRef.current) return;
    if (!chapterId) {
      setPanel("catalog");
      return;
    }
    if (!prompt.trim()) {
      document.getElementById("prompt")?.focus();
      return;
    }
    operationRef.current = true;
    setMutating(true);
    if (!(await save())) {
      operationRef.current = false;
      setMutating(false);
      return;
    }
    setError("");
    setBusy(true);
    setStream("");
    setPreviewId(null);
    const controller = new AbortController();
    abortRef.current = controller;
    let activeThread = threadId;
    try {
      if (!activeThread) {
        const r = await api("/conversations", {
          method: "POST",
          body: { projectId, title: editor.title || "新的写作对话" },
        });
        const t = r.conversation || r;
        patchData("conversations", t);
        activeThread = t.id;
        setThreadId(t.id);
      }
      await generate(
        {
          conversationId: activeThread,
          chapterId,
          prompt: prompt.trim(),
          mode,
          parentId,
          contextMode: referenceIds.length ? "selected" : "conversation",
          referenceChapterIds: referenceIds,
          includeSettings: useSettings,
        },
        controller.signal,
        (event, d) => {
          if (event === "start" && d.userMessage)
            patchData("messages", d.userMessage);
          if (event === "delta") setStream((v) => v + (d.content || ""));
          if (event === "done") {
            const m = d.assistantMessage;
            if (m) {
              patchData("messages", m);
              setPreviewId(m.id);
              setParentId(m.id);
            }
            if (d.workflowStage)
              patchData("conversations", {
                ...data.conversations.find((t) => t.id === activeThread),
                id: activeThread,
                projectId,
                workflowStage: d.workflowStage,
              });
            setStream("");
            if (d.truncated)
              inform("本次生成达到输出上限，采用前请检查句子是否完整。");
          }
        },
      );
      setPrompt("");
      setMobileAssistant(false);
    } catch (e) {
      if (e.name === "AbortError") inform("已停止生成，正文保持原样。");
      else setError(e.message);
      setStream("");
      await load({ preserve: true }).catch(() => {});
    } finally {
      setBusy(false);
      abortRef.current = null;
      operationRef.current = false;
      setMutating(false);
    }
  }
  async function adopt() {
    if (!requireUser() || !preview || busy || operationRef.current) return;
    operationRef.current = true;
    setMutating(true);
    try {
      if (!(await save())) return;
      const r = await api("/chapters/append", {
        method: "POST",
        body: {
          chapterId,
          messageId: preview.id,
          expectedRevision: editorRef.current.revision,
        },
      });
      const c = r.chapter || r;
      patchData("chapters", c);
      updateEditor({ ...c, dirty: false });
      patchData("messages", { ...preview, insertedChapterId: chapterId });
      setPreviewId(null);
      setSaved("saved");
      inform("候选已追加到正文。上一版已保存在历史中。");
    } catch (e) {
      setError(e.message);
    } finally {
      operationRef.current = false;
      setMutating(false);
    }
  }
  async function approve() {
    if (!requireUser()) return;
    try {
      await api("/workflow", {
        method: "PATCH",
        body: {
          conversationId: threadId,
          action: "approve",
          messageId: preview.id,
        },
      });
      patchData("conversations", {
        ...thread,
        workflowStage: "draft",
        approvedOutlineMessageId: preview.id,
      });
      setMode("draft");
      setPreviewId(null);
      inform("大纲已确认。写下要求，开始创作正文。");
      document.getElementById("prompt")?.focus();
    } catch (e) {
      setError(e.message);
    }
  }
  async function openHistory() {
    if (!requireUser()) return;
    try {
      const r = chapterId ? await api(`/chapters/${chapterId}/history`) : [];
      setHistory(r.history || r.revisions || r);
      setPanel("history");
    } catch (e) {
      setError(e.message);
    }
  }
  async function restore(h) {
    if (busy || operationRef.current) return;
    if (editorRef.current.dirty) {
      setError("本地还有未保存文字，请先导出本地稿，再核对历史版本。");
      return;
    }
    operationRef.current = true;
    setMutating(true);
    try {
      const r = await api(`/chapters/${chapterId}/restore`, {
        method: "POST",
        body: {
          revisionId: h.id,
          expectedRevision: editorRef.current.revision,
        },
      });
      const c = r.chapter || r;
      patchData("chapters", c);
      updateEditor({ ...c, dirty: false });
      setPanel(null);
      setSaved("saved");
      inform("历史版本已恢复，恢复前的稿件也已留存。");
    } catch (e) {
      setError(e.message);
    } finally {
      operationRef.current = false;
      setMutating(false);
    }
  }
  async function create(e) {
    e.preventDefault();
    if (!requireUser() || !newTitle.trim() || busy || operationRef.current)
      return;
    operationRef.current = true;
    setMutating(true);
    try {
      if (!(await save())) return;
      if (createType === "project") {
        const r = await api("/projects", {
          method: "POST",
          body: {
            title: newTitle.trim(),
            synopsis: "",
            genre: "长篇小说",
            createFirstChapter: true,
            firstChapterTitle: firstChapterTitle.trim() || "第一章",
            firstChapterContent: includeLocalDraft ? localDraft.content : "",
          },
        });
        const p = r.project || r;
        await load({ preferred: p.id });
        if (includeLocalDraft) {
          setHideLocalOffer(true);
          localDraftRisk.current = false;
        }
      } else if (createType === "chapter") {
        const r = await api("/chapters", {
          method: "POST",
          body: { projectId, title: newTitle.trim() },
        });
        const c = r.chapter || r;
        patchData("chapters", c);
        setChapterId(c.id);
        updateEditor({ ...c, dirty: false });
        setReferenceIds([c.id]);
        setPreviewId(null);
      } else {
        const r = await api("/conversations", {
          method: "POST",
          body: { projectId, title: newTitle.trim() },
        });
        const t = r.conversation || r;
        patchData("conversations", t);
        setThreadId(t.id);
        setParentId(null);
        setPreviewId(null);
      }
      setPanel(null);
      setNewTitle("");
    } catch (e) {
      setError(e.message);
    } finally {
      operationRef.current = false;
      setMutating(false);
    }
  }
  function startCreate(type, importLocal = false) {
    if (!requireUser()) return;
    if (busy) {
      inform("请先停止当前生成。");
      return;
    }
    setCreateType(type);
    setIncludeLocalDraft(importLocal);
    setFirstChapterTitle(importLocal ? localDraft.title || "第一章" : "第一章");
    setNewTitle("");
    setError("");
    setPanel("create");
  }
  async function saveMetadata(e) {
    e.preventDefault();
    if (!requireUser()) return;
    try {
      const r = await api(`/projects/${projectId}`, {
        method: "PATCH",
        body: metadata,
      });
      patchData("projects", r.project || r);
      setPanel(null);
      inform("作品设定已保存。");
    } catch (e) {
      setError(e.message);
    }
  }
  async function saveSettings(e) {
    e.preventDefault();
    if (!requireUser()) return;
    try {
      const r = await api("/settings", { method: "PATCH", body: settings });
      setSettings(r.settings || r);
      setPanel(null);
      inform("助手偏好已保存。");
    } catch (e) {
      setError(e.message);
    }
  }
  function exportChapter() {
    download(
      `${project?.title || "作品"}_${editor.title || "未命名章节"}.txt`,
      editor.title + "\n\n" + editor.content,
    );
    inform("已导出当前文字。");
  }
  const selectedChars = chapters
    .filter((c) => referenceIds.includes(c.id))
    .reduce(
      (n, c) => n + count(c.id === chapterId ? editor.content : c.content),
      0,
    );
  const loginDialog = panel === "login" && (
    <Dialog title="登录你的书房" onClose={() => setPanel(null)}>
      <div className="login-intro">
        <img src={stamp} alt="文行天下" />
        <p>留一盏灯，接着写。</p>
        <span>登录后保存作品，与文行一起推敲下一段故事。</span>
      </div>
      <form onSubmit={login} className="stack">
        <label>
          账号
          <input
            autoComplete="username"
            autoFocus
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="primary" disabled={loginBusy}>
          {loginBusy ? "正在开门…" : "进入书房"}
        </button>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <p className="fine-print">
          账号由站点管理员创建，暂不开放注册。没有账号也可以先在本机试写。
        </p>
      </form>
    </Dialog>
  );
  if (!user)
    return (
      <GuestWorkspace
        unsaved={localDraftUnsaved}
        onPersistence={trackLocalPersistence}
        draft={localDraft}
        onDraftChange={(draft) => {
          setLocalDraft(draft);
          setHideLocalOffer(false);
        }}
        ready={ready}
        online={online}
        onLogin={() => {
          setError("");
          setPanel("login");
        }}
      >
        {loginDialog}
      </GuestWorkspace>
    );
  return (
    <div
      className={`app ${!chapterId ? "empty-workspace" : ""} ${focus ? "focus-mode" : "overview-mode"} ${mobileAssistant ? "assistant-open" : ""}`}
    >
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="文行天下首页"
          onClick={(e) => {
            e.preventDefault();
            setPanel("catalog");
          }}
        >
          <span className="brand-mark">
            <img src={stamp} alt="" />
          </span>
          <span>文行天下</span>
        </a>
        <span className="header-rule" />
        <button className="breadcrumb" onClick={() => setPanel("catalog")}>
          {project?.title || "我的书架"}
          <span>/</span>
          <span>{chapterId ? `第${chapterIndex + 1}章` : "开始写作"}</span>
        </button>
        <nav aria-label="工作区">
          <button aria-label="目录" onClick={() => setPanel("catalog")}>
            <List size={17} />
            <span>目录</span>
          </button>
          <button aria-label="历史" onClick={openHistory} disabled={!chapterId}>
            <ClockCounterClockwise size={17} />
            <span>历史</span>
          </button>
          <button
            aria-label="导出"
            onClick={() => setPanel("export")}
            disabled={!chapterId}
          >
            <DownloadSimple size={17} />
            <span>导出</span>
          </button>
          <button className="focus-toggle" onClick={() => setFocus((v) => !v)}>
            {focus ? "退出专注" : "专注写作"}
          </button>
          <button
            className="account"
            onClick={() => (isGuest ? setPanel("login") : setPanel("account"))}
            title={isGuest ? "登录书房" : user.displayName || user.username}
            aria-label={isGuest ? "登录书房" : "账户与设置"}
          >
            {isGuest ? <SignIn size={19} /> : <GearSix size={19} />}
          </button>
        </nav>
      </header>
      {!ready && (
        <div className="loading-strip" role="status">
          正在打开书房…
        </div>
      )}
      {!focus && (
        <aside className="bookrail">
          <p className="eyebrow">我的作品</p>
          <button className="book-current" onClick={() => setPanel("catalog")}>
            <BookOpen size={20} />
            {project?.title || "打开书架"}
          </button>
          <div className="rail-chapters">
            {chapters.map((c, i) => (
              <button
                key={c.id}
                className={c.id === chapterId ? "selected" : ""}
                onClick={() => switchChapter(c)}
              >
                <small>{String(i + 1).padStart(2, "0")}</small>
                {c.title}
              </button>
            ))}
          </div>
          <button className="subtle" onClick={() => startCreate("chapter")}>
            <Plus size={16} />
            新建章节
          </button>
          <button
            className="subtle"
            onClick={() => {
              setMetadata({ ...project });
              setPanel("metadata");
            }}
            disabled={!projectId}
          >
            人物与作品设定
          </button>
          <div className="rail-bottom">
            <span>把故事，写下去。</span>
            <small>文行天下 · 私人写作书房</small>
          </div>
        </aside>
      )}
      <main className="writing-scroll" id="manuscript">
        <div className="manuscript">
          {hasLocalDraft && !hideLocalOffer && (
            <div className="local-draft-note">
              <span>
                {localDraftUnsaved
                  ? "本页还有尚未保存的试写，关闭前请存为作品或导出。"
                  : "此浏览器还有一份本地试写。"}
              </span>
              <button
                onClick={() =>
                  download(
                    `${localDraft.title || "我的试写"}.txt`,
                    localDraft.title + "\n\n" + localDraft.content,
                  )
                }
              >
                导出试写
              </button>
              <button onClick={() => startCreate("project", true)}>
                存为新作品 <ArrowRight size={14} />
              </button>
              <button
                className="icon"
                aria-label="暂不导入试写"
                onClick={() => setHideLocalOffer(true)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {chapterId ? (
            <>
              <p className="chapter-number">第{chapterIndex + 1}章</p>
              <input
                className="chapter-title"
                aria-label="章节标题"
                value={editor.title}
                readOnly={busy || mutating}
                maxLength={120}
                onChange={(e) => {
                  if (operationRef.current) return;
                  updateEditor((v) => ({
                    ...v,
                    title: e.target.value,
                    dirty: true,
                  }));
                  setSaved("unsaved");
                }}
              />
              <div className="copper-rule" />
              <AutoText
                className="prose editor"
                aria-label="章节正文"
                value={editor.content}
                readOnly={busy || mutating}
                spellCheck={false}
                placeholder="故事从这里开始。"
                onChange={(e) => {
                  if (operationRef.current) return;
                  updateEditor((v) => ({
                    ...v,
                    content: e.target.value,
                    dirty: true,
                  }));
                  setSaved("unsaved");
                }}
              />
              {(preview || busy) && (
                <section className="preview" aria-label="生成内容预览">
                  <div className="preview-heading">
                    <span>
                      {busy
                        ? "文行正在写作…"
                        : preview?.kind === "outline"
                          ? "大纲预览 · 待确认"
                          : ["draft", "rewrite"].includes(preview?.kind)
                            ? `${preview.kind === "rewrite" ? "改写" : "续写"}预览 · 尚未写入`
                            : "助手答复 · 未改动原稿"}
                    </span>
                    <small>
                      <PencilSimple size={14} />{" "}
                      {busy ? "可随时停止" : "保留当前文风"}
                    </small>
                  </div>
                  <div className="prose preview-text">
                    {busy
                      ? stream || "正在细读参考内容，请稍候。"
                      : preview?.content}
                  </div>
                  {busy ? (
                    <button
                      className="text-action"
                      onClick={() => abortRef.current?.abort()}
                    >
                      <Stop size={15} />
                      停止生成
                    </button>
                  ) : (
                    <div className="preview-actions">
                      {["draft", "rewrite"].includes(preview?.kind) &&
                        !preview.insertedChapterId && (
                          <button
                            className="primary"
                            disabled={mutating}
                            onClick={adopt}
                          >
                            {preview.kind === "rewrite"
                              ? "追加改写"
                              : "插入续写"}
                          </button>
                        )}
                      {preview?.kind === "outline" && (
                        <button
                          className="primary"
                          disabled={mutating}
                          onClick={approve}
                        >
                          确认大纲
                        </button>
                      )}
                      {preview?.insertedChapterId && (
                        <span className="adopted">
                          <Check size={16} />
                          已写入正文
                        </span>
                      )}
                      <button
                        onClick={() => {
                          setParentId(preview?.parentId || null);
                          setPreviewId(null);
                        }}
                      >
                        舍弃
                      </button>
                      <span>/</span>
                      <button
                        onClick={() => {
                          setParentId(preview.id);
                          setPrompt("换一个方向，");
                          document.getElementById("prompt")?.focus();
                          setMobileAssistant(true);
                        }}
                      >
                        换个方向
                      </button>
                    </div>
                  )}
                </section>
              )}
              <div className="manuscript-footer">
                <span
                  role="status"
                  className={
                    saveState === "error" || saveState === "conflict"
                      ? "warning-text"
                      : ""
                  }
                >
                  {saveState === "saving"
                    ? "保存中…"
                    : saveState === "saved"
                      ? "已保存"
                      : saveState === "unsaved"
                        ? "等待保存…"
                        : saveState === "conflict"
                          ? "版本冲突 · 本地稿已保留"
                          : "保存失败 · 请重试"}
                </span>
                <span>
                  字数：{count(editor.content).toLocaleString("zh-CN")}
                </span>
              </div>
              {(saveState === "error" || saveState === "conflict") && (
                <div className="save-recovery">
                  <button onClick={exportChapter}>导出本地稿</button>
                  <button onClick={() => save()}>重试保存</button>
                  <button onClick={openHistory}>核对历史</button>
                  <button onClick={() => setPanel("resolve")}>
                    加载服务器稿
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-manuscript">
              <p className="eyebrow">你的书房，准备好了</p>
              <h1>每个故事，都从一句话开始。</h1>
              <p>为作品取个名字，即可开始第一章。人物与设定可以边写边补充。</p>
              <button
                className="primary"
                onClick={() => startCreate(projectId ? "chapter" : "project")}
              >
                <Plus size={17} />
                {projectId ? "新建第一章" : "创建作品"}
              </button>
              {data.projects.length > 0 && (
                <button onClick={() => setPanel("catalog")}>打开书架</button>
              )}
            </div>
          )}
        </div>
      </main>
      {error && (
        <div className="error-banner" role="alert">
          <WarningCircle size={18} />
          <span>{error}</span>
          <button
            className="icon"
            aria-label="关闭错误提示"
            onClick={() => setError("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {chapterId && (
        <>
          <button
            className="mobile-assistant-toggle"
            onClick={() => setMobileAssistant((v) => !v)}
          >
            {mobileAssistant ? "返回书稿" : "唤起文行助手"}{" "}
            {mobileAssistant ? (
              <ArrowLeft size={16} />
            ) : (
              <PencilSimple size={16} />
            )}
          </button>
          <footer className="assistant-dock">
            <div className="assistant-context">
              <button
                className="assistant-mode"
                onClick={() => setPanel("mode")}
              >
                文行 · {modeNames[mode]}助手
              </button>
              <span className="dock-rule" />
              <div className="context-summary">
                <span>
                  本次参考：
                  {referenceIds.length ? `${referenceIds.length}章` : "仅对话"}
                  {useSettings ? " · 人物设定" : ""}
                </span>
                <button onClick={() => setPanel("context")}>调整范围</button>
              </div>
            </div>
            <form id="assistant-form" className="prompt-form" onSubmit={run}>
              <div className="prompt-row">
                <textarea
                  id="prompt"
                  aria-label="写作指令"
                  rows={1}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="想往哪个方向写？告诉文行你的想法……"
                  maxLength={12000}
                  disabled={busy}
                />
                {busy ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => abortRef.current?.abort()}
                  >
                    <Stop size={16} />
                    停止
                  </button>
                ) : (
                  <button className="primary" type="submit" disabled={!ready}>
                    提交
                  </button>
                )}
              </div>
              <div className="prompt-hint">
                <span>⌘ / Ctrl Enter 提交</span>
                {parentId && (
                  <button
                    type="button"
                    onClick={() => {
                      setParentId(null);
                      inform("已切回新的推演，不携带当前分支对话。");
                    }}
                  >
                    已选历史分支 · 重置
                  </button>
                )}
              </div>
            </form>
          </footer>
        </>
      )}
      {loginDialog}
      {panel === "catalog" && (
        <Dialog title="书架与目录" onClose={() => setPanel(null)} wide>
          <div className="catalog">
            <div className="books">
              <div className="section-label">
                作品
                <button
                  className="icon"
                  aria-label="新建作品"
                  onClick={() => startCreate("project")}
                >
                  <Plus size={18} />
                </button>
              </div>
              {data.projects.map((p) => (
                <button
                  key={p.id}
                  className={p.id === projectId ? "selected" : ""}
                  onClick={() =>
                    switchChapter(
                      data.chapters.find((c) => c.projectId === p.id),
                      p.id,
                    )
                  }
                >
                  <BookOpen size={18} />
                  <span>
                    {p.title}
                    <small>{p.genre || "长篇小说"}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="chapter-list">
              <div className="section-label">
                {project?.title || "章节"}
                <button
                  className="icon"
                  aria-label="新建章节"
                  onClick={() => startCreate("chapter")}
                  disabled={!projectId}
                >
                  <Plus size={18} />
                </button>
              </div>
              {chapters.map((c, i) => (
                <button
                  className={c.id === chapterId ? "selected" : ""}
                  key={c.id}
                  onClick={() => switchChapter(c)}
                >
                  <small>{String(i + 1).padStart(2, "0")}</small>
                  <span>{c.title}</span>
                  <small>{count(c.content)} 字</small>
                </button>
              ))}
              {!chapters.length && <p className="muted">这里还没有章节。</p>}
              <button
                className="subtle"
                onClick={() => {
                  setMetadata({ ...project });
                  setPanel("metadata");
                }}
                disabled={!projectId}
              >
                编辑作品与人物设定 <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {panel === "context" && (
        <Dialog title="这一轮，参考哪些内容" onClose={() => setPanel(null)}>
          <p className="muted">
            只发送你勾选的章节。未勾选的章节不会混入本次参考。
          </p>
          <div className="scope-actions">
            <button onClick={() => setReferenceIds(chapters.map((c) => c.id))}>
              整部作品
            </button>
            <button
              onClick={() => setReferenceIds(chapterId ? [chapterId] : [])}
            >
              仅当前章
            </button>
            <button onClick={() => setReferenceIds([])}>仅对话</button>
          </div>
          <div className="check-list">
            {chapters.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={referenceIds.includes(c.id)}
                  onChange={(e) =>
                    setReferenceIds((v) =>
                      e.target.checked
                        ? [...v, c.id]
                        : v.filter((id) => id !== c.id),
                    )
                  }
                />
                <span>
                  {c.title}
                  <small>
                    {count(
                      c.id === chapterId ? editor.content : c.content,
                    ).toLocaleString()}{" "}
                    字{c.id === chapterId ? " · 当前章" : ""}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={useSettings}
              onChange={(e) => setUseSettings(e.target.checked)}
            />
            同时参考作品梗概与人物设定
          </label>
          <p className="fine-print">
            已选正文约 {selectedChars.toLocaleString()} 字。字数不等于 token
            数；模型输入还包括设定、当前分支与指令。超出服务端预算时会提示调整，不自动截掉正文。
          </p>
          <button className="primary full" onClick={() => setPanel(null)}>
            使用这个范围
          </button>
        </Dialog>
      )}
      {panel === "mode" && (
        <Dialog title="这一笔，怎么写" onClose={() => setPanel(null)}>
          <div className="mode-list">
            {Object.entries(modeNames).map(([key, label]) => (
              <button
                className={mode === key ? "selected" : ""}
                key={key}
                onClick={() => {
                  setMode(key);
                  setPreviewId(null);
                  setPanel(null);
                  document.getElementById("prompt")?.focus();
                }}
              >
                <span>
                  {label}
                  <small>
                    {
                      {
                        draft: "沿着当前文风，写下一段",
                        outline: "先厘清冲突与节拍，确认后再写",
                        rewrite: "给出替代文本，采用时追加以便比较",
                        analyze: "检查人物、节奏与故事逻辑",
                        chat: "谈人物，聊走向，打开新思路",
                      }[key]
                    }
                  </small>
                </span>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {panel === "history" && (
        <Dialog title="每一步，都有来处" onClose={() => setPanel(null)} wide>
          <div className="history-grid">
            <section>
              <div className="section-label">书稿版本</div>
              <p className="fine-print">恢复会生成新版本，不删除现有稿件。</p>
              {history.length ? (
                history.map((h) => (
                  <details key={h.id}>
                    <summary>
                      {date(h.createdAt)}{" "}
                      <small>
                        {{
                          adopt: "采用续写",
                          edit: "编辑",
                          restore: "恢复版本",
                        }[h.reason] || "保存"}{" "}
                        · {count(h.content)} 字
                      </small>
                    </summary>
                    <p className="history-prose">{h.content}</p>
                    <button onClick={() => restore(h)}>恢复这一版</button>
                  </details>
                ))
              ) : (
                <p className="muted">
                  还没有历史版本。保存修改后，会在这里留下足迹。
                </p>
              )}
            </section>
            <section>
              <div className="section-label">
                推演与分支
                <button
                  className="icon"
                  onClick={() => startCreate("conversation")}
                  aria-label="新建推演"
                >
                  <Plus size={18} />
                </button>
              </div>
              <select
                aria-label="选择推演对话"
                value={threadId}
                onChange={(e) => {
                  if (busy) {
                    inform("请先停止当前生成。");
                    return;
                  }
                  setThreadId(e.target.value);
                  setParentId(null);
                  setPreviewId(null);
                }}
              >
                {data.conversations
                  .filter((t) => t.projectId === projectId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
              <div className="message-list">
                {messages.map((m) => (
                  <details key={m.id}>
                    <summary>
                      <span>
                        {m.role === "assistant"
                          ? `文行 · ${m.kind === "outline" ? "大纲" : "回复"}`
                          : "我的指令"}
                      </span>
                      <small>
                        {date(m.createdAt)}
                        {m.parentId ? " · 有前序" : ""}
                      </small>
                    </summary>
                    <p className="history-prose">{m.content}</p>
                    <div className="row-actions">
                      <button
                        disabled={busy}
                        onClick={() => {
                          setParentId(m.id);
                          setPreviewId(null);
                          setPanel(null);
                          inform(
                            "接下来会沿这一节点继续，其后的其他分支不会带入。",
                          );
                        }}
                      >
                        从这里分支
                      </button>
                      {m.role === "assistant" && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setPreviewId(m.id);
                            setParentId(m.id);
                            setPanel(null);
                          }}
                        >
                          查看候选
                        </button>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          </div>
        </Dialog>
      )}
      {panel === "export" && (
        <Dialog title="把文字带走" onClose={() => setPanel(null)}>
          <p className="muted">
            导出包含当前编辑文字。尚未采用的候选不会混入正文。
          </p>
          <div className="export-options">
            <button onClick={exportChapter}>
              <DownloadSimple size={23} />
              <span>
                当前章节<small>纯文本 .txt</small>
              </span>
            </button>
            <button
              onClick={() => {
                const text = chapters
                  .map(
                    (c) =>
                      `${c.title}\n\n${c.id === chapterId ? editor.content : c.content}`,
                  )
                  .join("\n\n────────\n\n");
                download(
                  `${project?.title || "作品"}.txt`,
                  `${project?.title || ""}\n\n${text}`,
                );
              }}
            >
              <BookOpen size={23} />
              <span>
                整部作品<small>按目录顺序合并 .txt</small>
              </span>
            </button>
            <button
              onClick={() => {
                api("/bootstrap")
                  .then((d) => {
                    if (editorRef.current.dirty)
                      d.chapters = d.chapters.map((c) =>
                        c.id === editorRef.current.id
                          ? { ...c, ...editorRef.current }
                          : c,
                      );
                    download(
                      `文行天下_作品备份_${new Date().toISOString().slice(0, 10)}.json`,
                      JSON.stringify(d, null, 2),
                      "application/json",
                    );
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              <ArrowCounterClockwise size={23} />
              <span>
                作品备份<small>作品、章节、推演与偏好 .json（不含密码）</small>
              </span>
            </button>
          </div>
          <p className="fine-print">
            JSON 是数据导出格式；服务器灾难恢复请使用运维备份脚本。
          </p>
        </Dialog>
      )}
      {panel === "create" && (
        <Dialog
          title={
            {
              project: "给新故事取个名字",
              chapter: "写下新的章节",
              conversation: "另开一条思路",
            }[createType]
          }
          onClose={() => setPanel(null)}
        >
          <form className="stack" onSubmit={create}>
            <label>
              名称
              <input
                autoFocus
                required
                maxLength={120}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={
                  createType === "project"
                    ? "输入你自己的作品名"
                    : "输入章节或思路名称"
                }
              />
            </label>
            {createType === "project" && (
              <>
                <label>
                  第一章标题
                  <input
                    value={firstChapterTitle}
                    maxLength={120}
                    onChange={(e) => setFirstChapterTitle(e.target.value)}
                    placeholder="第一章"
                  />
                </label>
                {hasLocalDraft && (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={includeLocalDraft}
                      onChange={(e) => setIncludeLocalDraft(e.target.checked)}
                    />
                    把此浏览器的试写带入第一章
                  </label>
                )}
                <p className="fine-print">
                  创建后直接进入正文。试写仅在勾选后上传，原本的本机试写仍会保留。
                </p>
              </>
            )}
            <button className="primary" disabled={mutating}>
              {mutating
                ? "正在创建…"
                : createType === "project"
                  ? "创建并开始写作"
                  : "创建"}
            </button>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </Dialog>
      )}
      {panel === "metadata" && (
        <Dialog title="故事的底稿" onClose={() => setPanel(null)}>
          <form className="stack" onSubmit={saveMetadata}>
            <label>
              作品名
              <input
                required
                maxLength={120}
                value={metadata.title || ""}
                onChange={(e) =>
                  setMetadata((v) => ({ ...v, title: e.target.value }))
                }
              />
            </label>
            <label>
              类型
              <input
                maxLength={60}
                value={metadata.genre || ""}
                onChange={(e) =>
                  setMetadata((v) => ({ ...v, genre: e.target.value }))
                }
              />
            </label>
            <label>
              梗概
              <textarea
                rows={3}
                value={metadata.synopsis || ""}
                onChange={(e) =>
                  setMetadata((v) => ({ ...v, synopsis: e.target.value }))
                }
              />
            </label>
            <label>
              人物、世界观与叙事约定
              <textarea
                rows={6}
                value={metadata.settings || ""}
                onChange={(e) =>
                  setMetadata((v) => ({ ...v, settings: e.target.value }))
                }
                placeholder="人物关系、时间线，以及你希望文行记住的细节。"
              />
            </label>
            <p className="fine-print">
              勾选“人物设定”时，以上内容会一并作为参考发送给模型服务。
            </p>
            <button className="primary">保存底稿</button>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </Dialog>
      )}
      {panel === "account" && (
        <Dialog title="书房设置" onClose={() => setPanel(null)}>
          <div className="account-info">
            <span>{user?.displayName || user?.username}</span>
            <small>私人书房 · 数据按账号隔离</small>
          </div>
          <div className="settings-links">
            <button onClick={() => setPanel("settings")}>
              助手偏好 <GearSix size={17} />
            </button>
            <button
              onClick={async () => {
                try {
                  const r = await api("/request-history");
                  setLogs(r.logs || r.requests || r);
                  setPanel("logs");
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              模型请求记录 <ClockCounterClockwise size={17} />
            </button>
            <a
              href="https://github.com/zzbcode/wenxing"
              target="_blank"
              rel="noreferrer"
            >
              开源项目 <ArrowRight size={17} />
            </a>
            <button onClick={logout}>
              <span>保存并退出</span>
              <SignOut size={17} />
            </button>
          </div>
        </Dialog>
      )}
      {panel === "settings" && (
        <Dialog title="文行，如何与你共写" onClose={() => setPanel(null)}>
          <form className="stack" onSubmit={saveSettings}>
            <label>
              写作约定
              <textarea
                rows={5}
                value={settings.systemPrompt || ""}
                onChange={(e) =>
                  setSettings((v) => ({ ...v, systemPrompt: e.target.value }))
                }
              />
            </label>
            <label>
              创作温度{" "}
              <span className="muted">{settings.temperature ?? 0.75}</span>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={settings.temperature ?? 0.75}
                onChange={(e) =>
                  setSettings((v) => ({
                    ...v,
                    temperature: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              单次输出上限（tokens）
              <input
                type="number"
                min="256"
                max="16384"
                step="128"
                value={settings.maxTokens || 4096}
                onChange={(e) =>
                  setSettings((v) => ({
                    ...v,
                    maxTokens: Number(e.target.value),
                  }))
                }
              />
            </label>
            <div className="model-note">
              <span>{model?.id || "DeepSeek-V4.1-Flash"}</span>
              <p>
                通过 TJUSAI 接入。中转接口实际上下文上限
                {model?.contextVerified
                  ? `：${model.contextLimit?.toLocaleString()} tokens`
                  : "尚未确认"}
                。
              </p>
              <small>
                服务端请求预算：
                {(model?.requestTokenBudget || 262144).toLocaleString()}{" "}
                tokens。预算是本应用的保护值，不代表供应商承诺。
              </small>
            </div>
            <button className="primary">保存偏好</button>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </Dialog>
      )}
      {panel === "logs" && (
        <Dialog title="模型请求记录" onClose={() => setPanel(null)} wide>
          <p className="muted">
            仅记录请求状态与用量，不重复存储整部书稿或模型密钥。
          </p>
          <div className="request-list">
            {logs.length ? (
              logs.map((l) => (
                <div key={l.id || l.requestId}>
                  <strong>
                    {date(l.createdAt)} · {modeNames[l.mode] || l.mode}
                  </strong>
                  <small>
                    {l.model || model?.id} ·{" "}
                    {l.status || l.responseStatus || "处理中"}
                  </small>
                  <span>
                    输入 {l.promptTokens ?? "—"} / 输出{" "}
                    {l.completionTokens ?? "—"} tokens
                  </span>
                  {l.errorMessage && <p>{l.errorMessage}</p>}
                </div>
              ))
            ) : (
              <p className="muted">还没有请求记录。</p>
            )}
          </div>
        </Dialog>
      )}
      {panel === "resolve" && (
        <Dialog
          title="保留本地稿，再加载服务器版本"
          onClose={() => setPanel(null)}
        >
          <p className="muted">
            点击下方按钮会先下载当前本地稿件，然后加载服务器最新内容。请允许浏览器下载，并确认文件已保存。
          </p>
          <button
            className="primary full"
            onClick={async () => {
              if (busy || operationRef.current) return;
              operationRef.current = true;
              setMutating(true);
              exportChapter();
              try {
                const d = await api("/bootstrap");
                const c = d.chapters.find((c) => c.id === chapterId);
                if (!c)
                  throw new Error("服务器上已找不到本章，请保留导出的文件。");
                setData(d);
                updateEditor({ ...c, dirty: false });
                setSaved("saved");
                setError("");
                setPanel(null);
              } catch (e) {
                setError(e.message);
              } finally {
                operationRef.current = false;
                setMutating(false);
              }
            }}
          >
            导出本地稿并加载服务器稿
          </button>
        </Dialog>
      )}
    </div>
  );
}
