import fs from "node:fs";
import { Zalo, ThreadType } from "zca-js";
import { config } from "../config.js";

export const runtime = {
  apiClient: null,
  qrBase64: null,
};

export function loadQrAsBase64() {
  if (!fs.existsSync(config.qrFilePath)) return null;
  return fs.readFileSync(config.qrFilePath).toString("base64");
}

function shouldReply(content) {
  if (!config.onlyReplyPrefix) return true;
  return content.startsWith(config.onlyReplyPrefix);
}

function buildReply(content) {
  if (config.onlyReplyPrefix && content.startsWith(config.onlyReplyPrefix)) {
    const pure = content.slice(config.onlyReplyPrefix.length).trimStart();
    return `${config.echoPrefix}${pure}`;
  }
  return `${config.echoPrefix}${content}`;
}

export async function bootstrapZalo() {
  const zalo = new Zalo();
  const api = await zalo.loginQR({ qrPath: "./qr.png" });

  runtime.apiClient = api;
  runtime.qrBase64 = loadQrAsBase64();

  api.listener.on("message", async (message) => {
    try {
      const isPlainText = typeof message?.data?.content === "string";
      if (message?.isSelf || !isPlainText) return;
      const content = message.data.content.trim();
      if (!content || !shouldReply(content)) return;

      if (message.type === ThreadType.User || message.type === ThreadType.Group) {
        await api.sendMessage({ msg: buildReply(content), quote: message.data }, message.threadId, message.type);
      }
    } catch (error) {
      console.error("[zca-js] 处理消息失败:", error);
    }
  });

  api.listener.start();
  return api;
}
