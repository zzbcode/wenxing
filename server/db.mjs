import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export function openDatabase(path) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password TEXT NOT NULL,createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,ownerId TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,synopsis TEXT NOT NULL DEFAULT '',settings TEXT NOT NULL DEFAULT '',genre TEXT NOT NULL DEFAULT '长篇小说',createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS projects_owner ON projects(ownerId);
    CREATE TABLE IF NOT EXISTS chapters(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,sortOrder INTEGER NOT NULL,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS chapters_project ON chapters(projectId,sortOrder);
    CREATE TABLE IF NOT EXISTS chapterHistory(id TEXT PRIMARY KEY,chapterId TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,title TEXT NOT NULL,content TEXT NOT NULL,revision INTEGER NOT NULL,reason TEXT NOT NULL,createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,ownerId TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,workflowStage TEXT NOT NULL DEFAULT 'outline',approvedOutlineMessageId TEXT,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,chapterId TEXT REFERENCES chapters(id),parentId TEXT REFERENCES messages(id),role TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,model TEXT,insertedChapterId TEXT REFERENCES chapters(id),promptTokens INTEGER,completionTokens INTEGER,createdAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversationId,createdAt);
    CREATE TABLE IF NOT EXISTS settings(userId TEXT PRIMARY KEY REFERENCES users(id),value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requestLogs(id TEXT PRIMARY KEY,ownerId TEXT NOT NULL REFERENCES users(id),conversationId TEXT,mode TEXT,model TEXT,status TEXT NOT NULL,promptBytes INTEGER,promptTokens INTEGER,completionTokens INTEGER,finishReason TEXT,createdAt INTEGER NOT NULL,completedAt INTEGER);
  `);
  // Existing installations are upgraded in place without replacing writer data.
  const projectColumns = db.prepare("PRAGMA table_info(projects)").all();
  if (!projectColumns.some((column) => column.name === "settings"))
    db.exec(
      "ALTER TABLE projects ADD COLUMN settings TEXT NOT NULL DEFAULT ''",
    );
  return db;
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function createUser(db, { username, password, name = username }) {
  if (!/^[a-zA-Z0-9_.@-]{2,80}$/.test(username || ""))
    throw new Error("用户名需为2至80位字母、数字或 _.@-");
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    throw new Error("密码需为12至256位");
  const user = {
    id: randomUUID(),
    username,
    name: String(name).slice(0, 80),
    createdAt: Date.now(),
  };
  db.prepare(
    "INSERT INTO users(id,username,name,password,createdAt) VALUES(?,?,?,?,?)",
  ).run(user.id, username, user.name, passwordHash(password), user.createdAt);
  return user;
}
export const DEFAULT_SETTINGS = Object.freeze({
  assistantName: "文行",
  systemPrompt:
    "你是专业的中文长篇写作助手。尊重作者意图，保持人物、世界观、时间线、叙事视角与文风一致。",
  temperature: 0.75,
  topP: 0.9,
  maxTokens: 4096,
  contextMode: "chapter",
});
