import { openDatabase, createUser } from "./db.mjs";
import { resolve } from "node:path";
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
if (process.stdin.isTTY) {
  console.error("请通过标准输入传入密码，避免命令行历史记录密码。");
  process.exit(1);
}
let password = "";
for await (const chunk of process.stdin) {
  password += chunk;
  if (password.length > 300) throw new Error("密码过长");
}
password = password.replace(/\r?\n$/, "");
const db = openDatabase(process.env.DB_PATH || resolve("data/wenxing.sqlite"));
try {
  const user = createUser(db, {
    username: arg("--username"),
    password,
    name: arg("--name"),
  });
  console.log(`已创建用户 ${user.username}（${user.id}）`);
} catch (error) {
  console.error(
    error.code?.includes("SQLITE")
      ? "用户名已存在或数据库不可写"
      : error.message,
  );
  process.exitCode = 1;
} finally {
  db.close();
}
