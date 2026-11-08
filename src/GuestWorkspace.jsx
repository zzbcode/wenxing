import React, { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  DownloadSimple,
  SignIn,
} from "@phosphor-icons/react";

const KEY = "wenxing.local-draft.v1";
export function readLocalDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(KEY) || "null");
    return {
      title: typeof draft?.title === "string" ? draft.title : "",
      content: typeof draft?.content === "string" ? draft.content : "",
      storageVersion: draft?.storageVersion ?? null,
    };
  } catch {
    return { title: "", content: "", storageVersion: null };
  }
}
export function GuestWorkspace({
  onLogin,
  children,
  ready,
  online,
  draft,
  onDraftChange,
  unsaved,
  onPersistence,
}) {
  const [writing, setWriting] = useState(false);
  const [saved, setSaved] = useState(!unsaved);
  function persisted(value) {
    setSaved(value);
    onPersistence(value);
  }
  const draftRef = useRef(draft);
  const hasDraft = Boolean(draft.title || draft.content);
  const words = [...draft.content.replace(/\s/g, "")].length;
  const [storageConflict, setStorageConflict] = useState(false);
  function update(field, value) {
    let next = { ...draftRef.current, [field]: value };
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) || "null");
      if (
        (stored?.storageVersion ?? null) !== draftRef.current.storageVersion
      ) {
        setStorageConflict(true);
        persisted(false);
      } else {
        const persistedDraft = { ...next, storageVersion: crypto.randomUUID() };
        localStorage.setItem(KEY, JSON.stringify(persistedDraft));
        next = persistedDraft;
        persisted(true);
        setStorageConflict(false);
      }
    } catch {
      persisted(false);
    }
    draftRef.current = next;
    onDraftChange(next);
  }
  React.useEffect(() => {
    const changed = (event) => {
      if (event.key === KEY || event.key === null) {
        setStorageConflict(true);
        persisted(false);
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  React.useEffect(() => {
    const guard = (event) => {
      if (!saved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [saved]);
  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob([draft.title + "\n\n" + draft.content], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(draft.title.trim() || "我的试写").replace(/[\\/:*?"<>|]/g, "_")}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="guest-shell">
      <header className="topbar guest-header">
        <button
          className="brand"
          onClick={() => setWriting(false)}
          aria-label="文行天下首页"
        >
          <span className="brand-mark">
            <img
              src={`${import.meta.env.BASE_URL}assets/wen-seal.png`}
              alt=""
            />
          </span>
          <span>文行天下</span>
        </button>
        <span className="guest-header-note">私人写作书房</span>
        <nav aria-label="书房入口">
          {writing && (
            <button onClick={exportDraft} aria-label="导出试写">
              <DownloadSimple size={17} />
              <span>导出试写</span>
            </button>
          )}
          <button onClick={onLogin} aria-label="登录书房" disabled={!ready}>
            <SignIn size={17} />
            <span>登录书房</span>
          </button>
        </nav>
      </header>
      {!ready ? (
        <main className="welcome">
          <p role="status">正在打开书房…</p>
        </main>
      ) : writing ? (
        <main className="guest-writing">
          <div className="trial-heading">
            <button onClick={() => setWriting(false)}>
              <ArrowLeft size={15} /> 返回首页
            </button>
            <span>本地试写 · 无需账号</span>
          </div>
          <div className="manuscript trial-manuscript">
            <p className="chapter-number">这一页，写你自己的故事。</p>
            <input
              className="chapter-title"
              aria-label="试写标题"
              placeholder="给这一页起个名字"
              value={draft.title}
              maxLength={120}
              onChange={(e) => update("title", e.target.value)}
            />
            <div className="copper-rule" />
            <textarea
              className="prose trial-editor"
              aria-label="试写正文"
              autoFocus
              placeholder="从一句话开始，或粘贴你已有的片段……"
              value={draft.content}
              maxLength={2000000}
              onChange={(e) => update("content", e.target.value)}
              spellCheck={false}
            />
            <div className="manuscript-footer">
              <span role="status">
                {saved ? "已保存在此浏览器" : "试写尚未保存 · 请导出备份"}
              </span>
              <span>字数：{words.toLocaleString("zh-CN")}</span>
            </div>
            {!saved && (
              <p className="inline-error" role="alert">
                {storageConflict
                  ? "另一页面修改了本机试写，为避免互相覆盖，本页文字暂留在内存中。"
                  : "浏览器无法保存，当前文字还在内存中。"}
                关闭或刷新可能丢失，请先导出 TXT；也可登录后主动存为新作品。
              </p>
            )}
            <p className="fine-print">
              试写不上传服务器，也不调用模型。清除浏览器数据会移除试写，请及时导出。
            </p>
          </div>
          <aside className="trial-assistant">
            <div>
              <strong>需要一起推敲下一段？</strong>
              <p>登录后可使用续写、大纲与审稿，并把试写存为自己的新作品。</p>
            </div>
            <button onClick={onLogin}>
              登录使用文行 <ArrowRight size={16} />
            </button>
          </aside>
        </main>
      ) : (
        <main className="welcome">
          <div className="welcome-main">
            <p className="eyebrow">灯下长卷 · 为持续写作的人</p>
            <h1>
              这一页，
              <br />
              从你的故事开始。
            </h1>
            <div className="copper-rule" />
            <p className="welcome-description">
              安静地写，慢慢地推敲。
              <br />
              用章节整理长篇，让文行陪你构思、续写和审稿。
              <br />
              每一段生成的文字，都由你决定是否采用。
            </p>
            <div className="welcome-actions">
              <button className="primary" onClick={() => setWriting(true)}>
                {hasDraft ? "继续本机试写" : "先写一段"}
                <ArrowRight size={18} />
              </button>
              <button onClick={onLogin}>已有账号？登录书房</button>
            </div>
            <p className="fine-print">
              {hasDraft
                ? `此浏览器留有 ${words.toLocaleString("zh-CN")} 字试写。`
                : "无需账号即可试写，文字只保存在当前浏览器。"}
            </p>
          </div>
          <aside className="welcome-margin">
            <span className="margin-number">文 / 行</span>
            <h2>先落笔，再成篇。</h2>
            <p>
              从一句话到一部长篇，
              <br />
              书稿始终在你手中。
            </p>
            <dl>
              <div>
                <dt>写作</dt>
                <dd>章节、设定与版本留存</dd>
              </div>
              <div>
                <dt>推敲</dt>
                <dd>选好参考，再向文行提问</dd>
              </div>
              <div>
                <dt>采用</dt>
                <dd>预览候选，确认后写入正文</dd>
              </div>
            </dl>
          </aside>
          <footer className="welcome-foot">
            <p>
              这是自托管书房，账号由站点管理员创建，暂不开放注册。
              {!online && " 当前书房服务暂不可用，本地试写仍可使用。"}
            </p>
            <a
              href="https://github.com/zzbcode/wenxing#快速运行"
              target="_blank"
              rel="noreferrer"
            >
              从 GitHub 来？搭建自己的书房 <ArrowRight size={14} />
            </a>
          </footer>
        </main>
      )}
      {children}
    </div>
  );
}
