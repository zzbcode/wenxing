import { createApp } from "./app.mjs";
const app = createApp();
const server = app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "0.0.0.0",
  () => console.log(`文行天下 listening on ${process.env.PORT || 3001}`),
);
server.requestTimeout = 0;
function shutdown() {
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
