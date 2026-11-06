import { DatabaseSync } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync, chmodSync } from "node:fs";
const destination = process.argv[2];
if (!destination)
  throw new Error("用法: node server/backup.mjs <新备份文件路径>");
const path = resolve(destination);
if (existsSync(path)) throw new Error("备份文件已存在，拒绝覆盖");
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(
  process.env.DB_PATH || resolve("data/wenxing.sqlite"),
);
try {
  db.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  chmodSync(path, 0o600);
  console.log("SQLite一致性备份已完成");
} finally {
  db.close();
}
