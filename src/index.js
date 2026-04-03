import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import swaggerUiDist from "swagger-ui-dist";
import { ThreadType, Zalo } from "zca-js";

const ECHO_PREFIX = process.env.ECHO_PREFIX ?? "echo: ";
const ONLY_REPLY_PREFIX = process.env.ONLY_REPLY_PREFIX ?? "";
const HTTP_PORT = Number(process.env.PORT ?? 3000);

const SWAGGER_USERNAME = process.env.SWAGGER_USERNAME ?? "";
const SWAGGER_PASSWORD = process.env.SWAGGER_PASSWORD ?? "";
const SWAGGER_AUTH_ENABLED = Boolean(SWAGGER_USERNAME && SWAGGER_PASSWORD);

const API_TOKEN = process.env.API_TOKEN ?? "";
const API_AUTH_ENABLED = Boolean(API_TOKEN);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const QR_FILE_PATH = path.resolve(PROJECT_ROOT, "qr.png");

const SWAGGER_DIST_DIR = swaggerUiDist.getAbsoluteFSPath();

let qrBase64 = null;
let apiClient = null;

const qrResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean", example: true },
    ready: { type: "boolean", example: true },
    qrPath: { type: "string", example: "./qr.png" },
    mimeType: { type: "string", example: "image/png" },
    base64: { type: ["string", "null"], example: "iVBORw0KGgoAAAANSUhEUgAA..." },
    dataUrl: { type: ["string", "null"], example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..." },
  },
  required: ["ok", "ready", "qrPath", "mimeType", "base64", "dataUrl"],
};

const openapiDocument = {
  openapi: "3.0.3",
  info: {
    title: "ZCA JS AI Employee Service API",
    version: "1.2.0",
    description: "基于 zca-js 的 AI 员工社交中台接口（消息、好友、群组、社交动作）",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "System", description: "系统状态" },
    { name: "Docs", description: "Swagger/OpenAPI 文档" },
    { name: "QR", description: "登录二维码" },
    { name: "Profile", description: "账号与资料" },
    { name: "Social", description: "好友与社交关系" },
    { name: "Messaging", description: "消息发送与会话动作" },
    { name: "Groups", description: "群组相关" },
  ],
  components: {
    securitySchemes: {
      basicAuth: { type: "http", scheme: "basic" },
      bearerToken: { type: "http", scheme: "bearer" },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "健康检查",
        responses: { 200: { description: "服务正常" } },
      },
    },
    "/docs": {
      get: {
        tags: ["Docs"],
        summary: "Swagger UI 页面",
        security: [{ basicAuth: [] }],
        responses: { 200: { description: "Swagger UI HTML" }, 401: { description: "未授权" } },
      },
    },
    "/openapi.json": {
      get: {
        tags: ["Docs"],
        summary: "获取 OpenAPI JSON",
        security: [{ basicAuth: [] }],
        responses: { 200: { description: "OpenAPI 文档" }, 401: { description: "未授权" } },
      },
    },
    "/api/qr": {
      get: {
        tags: ["QR"],
        summary: "获取登录二维码（Base64）",
        security: [{ basicAuth: [] }],
        responses: {
          200: { description: "二维码已准备好", content: { "application/json": { schema: qrResponseSchema } } },
          202: { description: "二维码暂未准备好", content: { "application/json": { schema: qrResponseSchema } } },
          401: { description: "未授权" },
        },
      },
    },
    "/v1/profile": {
      get: {
        tags: ["Profile"],
        summary: "获取当前登录账号信息",
        security: [{ bearerToken: [] }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/friends": {
      get: {
        tags: ["Social"],
        summary: "获取好友列表",
        security: [{ bearerToken: [] }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/groups": {
      get: {
        tags: ["Groups"],
        summary: "获取群组列表",
        security: [{ bearerToken: [] }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/users/{userId}": {
      get: {
        tags: ["Profile"],
        summary: "按用户ID获取用户资料",
        security: [{ bearerToken: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/users/search": {
      get: {
        tags: ["Social"],
        summary: "按手机号搜索用户",
        security: [{ bearerToken: [] }],
        parameters: [{ name: "phone", in: "query", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/friends/requests/sent": {
      get: {
        tags: ["Social"],
        summary: "获取已发送好友请求",
        security: [{ bearerToken: [] }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/friends/requests/status/{userId}": {
      get: {
        tags: ["Social"],
        summary: "查询与指定用户的好友关系/请求状态",
        security: [{ bearerToken: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/friends/requests": {
      post: {
        tags: ["Social"],
        summary: "发送好友请求",
        security: [{ bearerToken: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  userId: { type: "string" },
                  message: { type: "string", example: "你好，我是AI员工助理" },
                },
                required: ["userId"],
              },
            },
          },
        },
        responses: { 200: { description: "成功" }, 400: { description: "参数错误" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/friends/requests/{userId}/accept": {
      post: {
        tags: ["Social"],
        summary: "同意好友申请",
        security: [{ bearerToken: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/friends/requests/{userId}/reject": {
      post: {
        tags: ["Social"],
        summary: "拒绝好友申请",
        security: [{ bearerToken: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/friends/requests/{userId}/undo": {
      post: {
        tags: ["Social"],
        summary: "撤销已发送的好友请求",
        security: [{ bearerToken: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/groups/{groupId}": {
      get: {
        tags: ["Groups"],
        summary: "按群ID获取群信息",
        security: [{ bearerToken: [] }],
        parameters: [{ name: "groupId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/groups/{groupId}/history": {
      get: {
        tags: ["Groups"],
        summary: "获取群聊天历史",
        security: [{ bearerToken: [] }],
        parameters: [
          { name: "groupId", in: "path", required: true, schema: { type: "string" } },
          { name: "count", in: "query", required: false, schema: { type: "integer", default: 20 } },
        ],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/groups/{groupId}/members/{memberId}": {
      post: {
        tags: ["Groups"],
        summary: "拉用户进群",
        security: [{ bearerToken: [] }],
        parameters: [
          { name: "groupId", in: "path", required: true, schema: { type: "string" } },
          { name: "memberId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
      delete: {
        tags: ["Groups"],
        summary: "移出群成员",
        security: [{ bearerToken: [] }],
        parameters: [
          { name: "groupId", in: "path", required: true, schema: { type: "string" } },
          { name: "memberId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/group-members/{memberId}": {
      get: {
        tags: ["Groups"],
        summary: "获取群成员资料（可传单个memberId）",
        security: [{ bearerToken: [] }],
        parameters: [{ name: "memberId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "成功" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/messages": {
      post: {
        tags: ["Messaging"],
        summary: "发送文本消息",
        security: [{ bearerToken: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  threadId: { type: "string", example: "1234567890123456789" },
                  threadType: { type: "string", enum: ["user", "group"], example: "user" },
                  msg: { type: "string", example: "hello" },
                },
                required: ["threadId", "threadType", "msg"],
              },
            },
          },
        },
        responses: { 200: { description: "发送成功" }, 400: { description: "参数错误" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/messages/typing": {
      post: {
        tags: ["Messaging"],
        summary: "发送正在输入事件",
        security: [{ bearerToken: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  threadId: { type: "string" },
                  threadType: { type: "string", enum: ["user", "group"], example: "user" },
                },
                required: ["threadId", "threadType"],
              },
            },
          },
        },
        responses: { 200: { description: "成功" }, 400: { description: "参数错误" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/messages/forward": {
      post: {
        tags: ["Messaging"],
        summary: "转发消息（文本）",
        security: [{ bearerToken: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string" },
                  threadIds: { type: "array", items: { type: "string" } },
                  threadType: { type: "string", enum: ["user", "group"], example: "user" },
                },
                required: ["message", "threadIds", "threadType"],
              },
            },
          },
        },
        responses: { 200: { description: "成功" }, 400: { description: "参数错误" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/messages/undo": {
      post: {
        tags: ["Messaging"],
        summary: "撤回消息",
        security: [{ bearerToken: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  threadId: { type: "string" },
                  threadType: { type: "string", enum: ["user", "group"], example: "user" },
                  msgId: { type: "string" },
                  cliMsgId: { type: "string" },
                },
                required: ["threadId", "threadType", "msgId", "cliMsgId"],
              },
            },
          },
        },
        responses: { 200: { description: "成功" }, 400: { description: "参数错误" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
    "/v1/messages/seen": {
      post: {
        tags: ["Messaging"],
        summary: "发送已读事件",
        security: [{ bearerToken: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  threadType: { type: "string", enum: ["user", "group"], example: "user" },
                  messages: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        msgId: { type: "string" },
                        cliMsgId: { type: "string" },
                        uidFrom: { type: "string" },
                        idTo: { type: "string" },
                        msgType: { type: "string" },
                        st: { type: "integer" },
                        at: { type: "integer" },
                        cmd: { type: "integer" },
                        ts: { type: ["string", "integer"] },
                      },
                      required: ["msgId", "cliMsgId", "uidFrom", "idTo", "msgType", "st", "at", "cmd", "ts"],
                    },
                  },
                },
                required: ["threadType", "messages"],
              },
            },
          },
        },
        responses: { 200: { description: "成功" }, 400: { description: "参数错误" }, 401: { description: "未授权" }, 503: { description: "未登录" } },
      },
    },
  },
};

function shouldReply(content) {
  if (!ONLY_REPLY_PREFIX) return true;
  return content.startsWith(ONLY_REPLY_PREFIX);
}

function buildReply(content) {
  if (ONLY_REPLY_PREFIX && content.startsWith(ONLY_REPLY_PREFIX)) {
    const pureContent = content.slice(ONLY_REPLY_PREFIX.length).trimStart();
    return `${ECHO_PREFIX}${pureContent}`;
  }
  return `${ECHO_PREFIX}${content}`;
}

function loadQrAsBase64() {
  if (!fs.existsSync(QR_FILE_PATH)) return null;
  const fileBuffer = fs.readFileSync(QR_FILE_PATH);
  return fileBuffer.toString("base64");
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function unauthorized(res, type = "basic") {
  if (type === "basic") {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "WWW-Authenticate": 'Basic realm="Swagger Docs"' });
    res.end(JSON.stringify({ ok: false, message: "Unauthorized" }));
    return;
  }
  json(res, 401, { ok: false, message: "Unauthorized" });
}

function isSwaggerAuthorized(req) {
  if (!SWAGGER_AUTH_ENABLED) return true;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf-8");
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return false;
  return decoded.slice(0, idx) === SWAGGER_USERNAME && decoded.slice(idx + 1) === SWAGGER_PASSWORD;
}

function isApiAuthorized(req) {
  if (!API_AUTH_ENABLED) return true;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice(7).trim() === API_TOKEN;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("请求体过大"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON 解析失败"));
      }
    });
    req.on("error", reject);
  });
}

function swaggerHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>ZCA JS Echo API Docs</title><link rel="stylesheet" type="text/css" href="/docs/swagger-ui.css" /></head><body><div id="swagger-ui"></div><script src="/docs/swagger-ui-bundle.js"></script><script src="/docs/swagger-ui-standalone-preset.js"></script><script>window.onload=function(){window.ui=SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',deepLinking:true,presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:'StandaloneLayout'})};</script></body></html>`;
}

function serveSwaggerUiAsset(pathname, res) {
  if (pathname === "/docs" || pathname === "/docs/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(swaggerHtml());
    return true;
  }
  if (pathname.startsWith("/docs/")) {
    const relativeFilePath = pathname.replace("/docs/", "");
    if (!relativeFilePath || relativeFilePath.includes("..")) return false;
    const absolutePath = path.join(SWAGGER_DIST_DIR, relativeFilePath);
    if (!absolutePath.startsWith(SWAGGER_DIST_DIR) || !fs.existsSync(absolutePath)) return false;
    const ext = path.extname(absolutePath);
    const contentTypeMap = { ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8", ".map": "application/json; charset=utf-8" };
    res.writeHead(200, { "Content-Type": contentTypeMap[ext] ?? "application/octet-stream" });
    fs.createReadStream(absolutePath).pipe(res);
    return true;
  }
  return false;
}

function getThreadType(input) {
  if (input === "user") return ThreadType.User;
  if (input === "group") return ThreadType.Group;
  return null;
}

async function handleCommonApi(req, res, urlObj) {
  if (!isApiAuthorized(req)) {
    unauthorized(res, "bearer");
    return true;
  }
  if (!apiClient) {
    json(res, 503, { ok: false, message: "Zalo 未登录，请先扫码登录" });
    return true;
  }

  if (req.method === "GET" && urlObj.pathname === "/v1/profile") return json(res, 200, { ok: true, data: await apiClient.fetchAccountInfo() }), true;
  if (req.method === "GET" && urlObj.pathname === "/v1/friends") return json(res, 200, { ok: true, data: await apiClient.getAllFriends() }), true;
  if (req.method === "GET" && urlObj.pathname === "/v1/groups") return json(res, 200, { ok: true, data: await apiClient.getAllGroups() }), true;

  if (req.method === "GET" && urlObj.pathname.startsWith("/v1/users/")) {
    const userId = decodeURIComponent(urlObj.pathname.replace("/v1/users/", "")).trim();
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.getUserInfo(userId) }), true;
  }

  if (req.method === "GET" && urlObj.pathname === "/v1/users/search") {
    const phone = (urlObj.searchParams.get("phone") ?? "").trim();
    if (!phone) return json(res, 400, { ok: false, message: "phone 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.findUser(phone) }), true;
  }

  if (req.method === "GET" && urlObj.pathname === "/v1/friends/requests/sent") {
    return json(res, 200, { ok: true, data: await apiClient.getSentFriendRequest() }), true;
  }

  if (req.method === "GET" && urlObj.pathname.startsWith("/v1/friends/requests/status/")) {
    const userId = decodeURIComponent(urlObj.pathname.replace("/v1/friends/requests/status/", "")).trim();
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.getFriendRequestStatus(userId) }), true;
  }

  if (req.method === "POST" && urlObj.pathname === "/v1/friends/requests") {
    const body = await parseBody(req);
    const userId = `${body.userId ?? ""}`.trim();
    const message = `${body.message ?? ""}`.trim() || "你好，很高兴认识你";
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.sendFriendRequest(message, userId) }), true;
  }

  if (req.method === "POST" && urlObj.pathname.startsWith("/v1/friends/requests/") && urlObj.pathname.endsWith("/accept")) {
    const userId = decodeURIComponent(urlObj.pathname.replace("/v1/friends/requests/", "").replace("/accept", "")).trim();
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.acceptFriendRequest(userId) }), true;
  }

  if (req.method === "POST" && urlObj.pathname.startsWith("/v1/friends/requests/") && urlObj.pathname.endsWith("/reject")) {
    const userId = decodeURIComponent(urlObj.pathname.replace("/v1/friends/requests/", "").replace("/reject", "")).trim();
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.rejectFriendRequest(userId) }), true;
  }

  if (req.method === "POST" && urlObj.pathname.startsWith("/v1/friends/requests/") && urlObj.pathname.endsWith("/undo")) {
    const userId = decodeURIComponent(urlObj.pathname.replace("/v1/friends/requests/", "").replace("/undo", "")).trim();
    if (!userId) return json(res, 400, { ok: false, message: "userId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.undoFriendRequest(userId) }), true;
  }

  if (req.method === "GET" && urlObj.pathname.startsWith("/v1/groups/")) {
    if (urlObj.pathname.endsWith("/history")) {
      const groupId = decodeURIComponent(urlObj.pathname.replace("/v1/groups/", "").replace("/history", "")).trim();
      const count = Number(urlObj.searchParams.get("count") ?? 20);
      if (!groupId) return json(res, 400, { ok: false, message: "groupId 不能为空" }), true;
      return json(res, 200, { ok: true, data: await apiClient.getGroupChatHistory(groupId, Number.isFinite(count) ? count : 20) }), true;
    }

    const groupId = decodeURIComponent(urlObj.pathname.replace("/v1/groups/", "")).trim();
    if (!groupId) return json(res, 400, { ok: false, message: "groupId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.getGroupInfo(groupId) }), true;
  }

  if (req.method === "GET" && urlObj.pathname.startsWith("/v1/group-members/")) {
    const memberId = decodeURIComponent(urlObj.pathname.replace("/v1/group-members/", "")).trim();
    if (!memberId) return json(res, 400, { ok: false, message: "memberId 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.getGroupMembersInfo(memberId) }), true;
  }

  if ((req.method === "POST" || req.method === "DELETE") && urlObj.pathname.startsWith("/v1/groups/") && urlObj.pathname.includes("/members/")) {
    const match = urlObj.pathname.match(/^\/v1\/groups\/(.+?)\/members\/(.+)$/);
    if (!match) return false;
    const groupId = decodeURIComponent(match[1]).trim();
    const memberId = decodeURIComponent(match[2]).trim();
    if (!groupId || !memberId) return json(res, 400, { ok: false, message: "groupId/memberId 不能为空" }), true;

    if (req.method === "POST") {
      return json(res, 200, { ok: true, data: await apiClient.addUserToGroup(memberId, groupId) }), true;
    }

    return json(res, 200, { ok: true, data: await apiClient.removeUserFromGroup(memberId, groupId) }), true;
  }

  if (req.method === "POST" && urlObj.pathname === "/v1/messages") {
    const body = await parseBody(req);
    const threadId = `${body.threadId ?? ""}`.trim();
    const threadType = getThreadType(body.threadType);
    const msg = `${body.msg ?? ""}`.trim();
    if (!threadId || !threadType || !msg) return json(res, 400, { ok: false, message: "参数不完整，必须提供 threadId、threadType(user/group)、msg" }), true;
    return json(res, 200, { ok: true, data: await apiClient.sendMessage({ msg }, threadId, threadType) }), true;
  }

  if (req.method === "POST" && urlObj.pathname === "/v1/messages/typing") {
    const body = await parseBody(req);
    const threadId = `${body.threadId ?? ""}`.trim();
    const threadType = getThreadType(body.threadType);
    if (!threadId || !threadType) return json(res, 400, { ok: false, message: "threadId/threadType 不能为空" }), true;
    return json(res, 200, { ok: true, data: await apiClient.sendTypingEvent(threadId, threadType) }), true;
  }

  if (req.method === "POST" && urlObj.pathname === "/v1/messages/forward") {
    const body = await parseBody(req);
    const message = `${body.message ?? ""}`.trim();
    const threadIds = Array.isArray(body.threadIds) ? body.threadIds.map((x) => `${x}`.trim()).filter(Boolean) : [];
    const threadType = getThreadType(body.threadType);
    if (!message || threadIds.length === 0 || !threadType) return json(res, 400, { ok: false, message: "message/threadIds/threadType 参数不完整" }), true;
    return json(res, 200, { ok: true, data: await apiClient.forwardMessage({ message }, threadIds, threadType) }), true;
  }

  if (req.method === "POST" && urlObj.pathname === "/v1/messages/undo") {
    const body = await parseBody(req);
    const threadId = `${body.threadId ?? ""}`.trim();
    const threadType = getThreadType(body.threadType);
    const msgId = `${body.msgId ?? ""}`.trim();
    const cliMsgId = `${body.cliMsgId ?? ""}`.trim();
    if (!threadId || !threadType || !msgId || !cliMsgId) return json(res, 400, { ok: false, message: "threadId/threadType/msgId/cliMsgId 参数不完整" }), true;
    return json(res, 200, { ok: true, data: await apiClient.undo({ msgId, cliMsgId }, threadId, threadType) }), true;
  }

  if (req.method === "POST" && urlObj.pathname === "/v1/messages/seen") {
    const body = await parseBody(req);
    const threadType = getThreadType(body.threadType);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!threadType || messages.length === 0) return json(res, 400, { ok: false, message: "threadType/messages 参数不完整" }), true;
    return json(res, 200, { ok: true, data: await apiClient.sendSeenEvent(messages, threadType) }), true;
  }

  return false;
}

function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = urlObj.pathname;

    const isSwaggerRoute = req.method === "GET" && (pathname === "/docs" || pathname === "/docs/" || pathname.startsWith("/docs/") || pathname === "/openapi.json" || pathname === "/api/qr");
    if (isSwaggerRoute && !isSwaggerAuthorized(req)) return unauthorized(res, "basic");

    if (req.method === "GET" && (pathname === "/docs" || pathname === "/docs/" || pathname.startsWith("/docs/"))) {
      if (serveSwaggerUiAsset(pathname, res)) return;
    }

    if (req.method === "GET" && pathname === "/openapi.json") return json(res, 200, openapiDocument);
    if (req.method === "GET" && pathname === "/health") return json(res, 200, { ok: true, service: "zca-js-echo", loggedIn: Boolean(apiClient) });
    if (req.method === "GET" && pathname === "/api/qr") {
      const currentBase64 = qrBase64 ?? loadQrAsBase64();
      const ready = Boolean(currentBase64);
      return json(res, ready ? 200 : 202, { ok: true, ready, qrPath: "./qr.png", mimeType: "image/png", base64: currentBase64, dataUrl: currentBase64 ? `data:image/png;base64,${currentBase64}` : null });
    }

    try {
      if (await handleCommonApi(req, res, urlObj)) return;
    } catch (error) {
      console.error("[http] 接口调用失败:", error);
      return json(res, 500, { ok: false, message: error?.message ?? "Internal Server Error" });
    }

    return json(res, 404, { ok: false, message: "Not Found" });
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[http] 健康检查: http://localhost:${HTTP_PORT}/health`);
    console.log(`[http] QR接口: http://localhost:${HTTP_PORT}/api/qr`);
    console.log(`[http] OpenAPI: http://localhost:${HTTP_PORT}/openapi.json`);
    console.log(`[http] Swagger UI: http://localhost:${HTTP_PORT}/docs`);
    console.log(`[http] 常用API前缀: http://localhost:${HTTP_PORT}/v1`);
    if (SWAGGER_AUTH_ENABLED) console.log("[http] Swagger 鉴权已启用（Basic Auth）");
    if (API_AUTH_ENABLED) console.log("[http] 业务接口鉴权已启用（Bearer Token）");
  });

  return server;
}

async function bootstrapZalo() {
  const zalo = new Zalo();
  const api = await zalo.loginQR({ qrPath: "./qr.png" });

  qrBase64 = loadQrAsBase64();
  if (qrBase64) console.log("[zca-js] 检测到 ./qr.png，已转换为 Base64，可通过 /api/qr 获取");

  console.log("[zca-js] 登录成功，开始监听消息...");
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

async function main() {
  const server = startHttpServer();
  apiClient = await bootstrapZalo();

  const shutdown = () => {
    try {
      apiClient?.listener?.stop?.();
    } catch {}
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[zca-js] 服务启动失败:", error);
  process.exit(1);
});
