// Synthetic development fixture only. Production never enables a mock provider.
import http from "node:http";
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  const system = body.messages[0].content;
  const output = system.includes("只输出大纲")
    ? "一、雨夜来客：沈砚收到第二封信。\n二、话中破绽：来客说出已封存的旧名。\n三、留白：暂不揭示身份，章末以敲门声收束。"
    : "沈砚没有立刻开门。雨声替来人掩去半句话，却掩不住那声旧称。\n\n“你认错人了。”他将信压在灯下，目光落在门缝那一道湿痕上。";
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  let i = 0;
  const timer = setInterval(() => {
    if (i >= output.length) {
      res.write(
        "data: " +
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 90, completion_tokens: 60 },
          }) +
          "\n\ndata: [DONE]\n\n",
      );
      clearInterval(timer);
      res.end();
    } else {
      res.write(
        "data: " +
          JSON.stringify({
            choices: [{ delta: { content: output.slice(i, i + 4) } }],
          }) +
          "\n\n",
      );
      i += 4;
    }
  }, 75);
  res.on("close", () => clearInterval(timer));
});
server.listen(3002, "127.0.0.1");
