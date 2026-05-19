import "dotenv/config";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import swaggerUiDist from "swagger-ui-dist";
import { HttpProxyAgent } from "http-proxy-agent";
import nodeFetch from "node-fetch";
import { WebSocketServer } from "ws";
import { LoginQRCallbackEventType, ThreadType, Zalo } from "zca-js";

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
/** 扫码成功后写入 Cookie + imei，重启后优先走 zalo.login；路径可用环境变量 ZALO_SESSION_FILE 覆盖 */
const SESSION_FILE_PATH = path.resolve(PROJECT_ROOT, process.env.ZALO_SESSION_FILE ?? "zalo-session.json");
/** 须与扫码登录时一致；变更会导致 imei 与已存会话不匹配，需重新扫码 */
const ZALO_USER_AGENT =
  process.env.ZALO_USER_AGENT ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
const ZALO_LANGUAGE = process.env.ZALO_LANGUAGE ?? "vi";
/** GET /api/qr 在扫码流程已启动时短暂等待二维码就绪，避免首包早于 QRCodeGenerated 回调（可用环境变量调节） */
const QR_HTTP_WAIT_MS = Number(process.env.QR_HTTP_WAIT_MS ?? 25_000);
const QR_HTTP_POLL_MS = Number(process.env.QR_HTTP_POLL_MS ?? 25);

/** 直连时 node-fetch 使用的 socket 超时（毫秒）；避免默认过短。代理路径见 zca-js 文档（HttpProxyAgent + node-fetch） */
const ZALO_FETCH_CONNECT_TIMEOUT_MS = Number(process.env.ZALO_FETCH_CONNECT_TIMEOUT_MS ?? 60_000);
/** 可选代理；优先级 ZALO_PROXY > HTTPS_PROXY > HTTP_PROXY。配置后与 zca-js 文档一致：`agent` + `node-fetch` polyfill */
const ZALO_HTTP_PROXY =
  process.env.ZALO_PROXY?.trim() || process.env.HTTPS_PROXY?.trim() || process.env.HTTP_PROXY?.trim() || "";

function maskProxyForLog(uri) {
  try {
    const u = new URL(uri);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return "(无效的代理地址)";
  }
}

function buildZaloConstructorOptions() {
  if (ZALO_HTTP_PROXY) {
    return {
      agent: new HttpProxyAgent(ZALO_HTTP_PROXY),
      polyfill: nodeFetch,
    };
  }
  const ms = ZALO_FETCH_CONNECT_TIMEOUT_MS;
  const httpAgent = new http.Agent({ keepAlive: true, timeout: ms });
  const httpsAgent = new https.Agent({ keepAlive: true, timeout: ms });
  return {
    polyfill: (url, init = {}) =>
      nodeFetch(url, {
        ...(init ?? {}),
        agent: (parsedUrl) => (parsedUrl.protocol === "http:" ? httpAgent : httpsAgent),
      }),
  };
}

const ZALO_CLIENT_OPTIONS = buildZaloConstructorOptions();

const SWAGGER_DIST_DIR = swaggerUiDist.getAbsoluteFSPath();

let qrBase64 = null;
let apiClient = null;
/** 首次请求 /api/qr 时启动；失败置空后可再次触发 */
let zaloBootstrapPromise = null;
let wss = null;
const clients = new Set();

const qrResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean", example: true },
    loggedIn: { type: "boolean", example: false, description: "已为登录态（Cookie 或扫码完成）时可跳过扫码" },
    ready: { type: "boolean", example: true },
    qrPath: { type: "string", example: "./qr.png" },
    mimeType: { type: "string", example: "image/png" },
    base64: { type: ["string", "null"], example: "iVBORw0KGgoAAAANSUhEUgAA..." },
    dataUrl: { type: ["string", "null"], example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..." },
    message: { type: "string", example: "已登录，无需扫码" },
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
    { name: "WebSocket", description: "实时消息推送" },
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
        summary: "获取登录二维码（Base64）；优先尝试本地 Cookie，无效时再扫码；首次触发登录",
        security: [{ basicAuth: [] }],
        responses: {
          200: { description: "二维码已准备好，或已 Cookie 登录无需二维码", content: { "application/json": { schema: qrResponseSchema } } },
          202: { description: "二维码暂未准备好（登录流程已启动时可轮询直至 ready）", content: { "application/json": { schema: qrResponseSchema } } },
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
    "/ws": {
      get: {
        tags: ["WebSocket"],
        summary: "WebSocket 连接端点",
        description: "用于实时接收消息推送的 WebSocket 连接。连接后，当收到新消息时，会通过 WebSocket 推送消息数据。",
        responses: {
          101: {
            description: "Switching Protocols",
            headers: {
              "Upgrade": { description: "websocket", schema: { type: "string" } },
              "Connection": { description: "Upgrade", schema: { type: "string" } },
            },
          },
        },
      },
    },
  },
};

function attachZaloMessageListener(api) {
  console.log("[zca-js] 登录成功，开始监听消息...");
  api.listener.on("message", async (message) => {
    console.log(message);
    try {
      const wsMessage = JSON.stringify({
        type: "message",
        data: message,
      });
      clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(wsMessage);
        }
      });
    } catch (error) {
      console.error("[zca-js] 转发消息到 WebSocket 失败:", error);
    }
  });

  api.listener.start();
}

function loadQrAsBase64() {
  if (!fs.existsSync(QR_FILE_PATH)) return null;
  const fileBuffer = fs.readFileSync(QR_FILE_PATH);
  return fileBuffer.toString("base64");
}

/** 扫码登录成功后删除本地 qr 文件并清空缓存，避免遗留敏感登录入口 */
function removeLocalQrAfterLogin() {
  qrBase64 = null;
  try {
    if (fs.existsSync(QR_FILE_PATH)) {
      fs.unlinkSync(QR_FILE_PATH);
      console.log(`[zca-js] 已删除本地二维码文件: ${QR_FILE_PATH}`);
    }
  } catch (err) {
    console.warn("[zca-js] 删除二维码文件失败:", err?.message ?? err);
  }
}

function loadPersistedSession() {
  try {
    if (!fs.existsSync(SESSION_FILE_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(SESSION_FILE_PATH, "utf-8"));
    if (!data?.imei || !data?.userAgent || !Array.isArray(data?.cookies)) return null;
    return data;
  } catch {
    return null;
  }
}

/** 将 zca-js 上下文中 CookieJar 序列化写入磁盘，供下次 zalo.login 使用（参见文档 Cookie 登录）。 */
function persistZaloSession(api) {
  try {
    const ctx = api.getContext();
    const jarJson = ctx.cookie?.toJSON?.();
    const cookies = jarJson?.cookies;
    if (!ctx.imei || !ctx.userAgent || !Array.isArray(cookies)) {
      console.warn("[zca-js] 无法持久化会话：上下文不完整");
      return;
    }
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      imei: ctx.imei,
      userAgent: ctx.userAgent,
      language: ctx.language ?? ZALO_LANGUAGE,
      cookies,
    };
    fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(payload), "utf-8");
    console.log(`[zca-js] 会话已写入 ${SESSION_FILE_PATH}`);
  } catch (error) {
    console.error("[zca-js] 写入会话文件失败:", error);
  }
}

async function tryLoginWithSavedSession(zalo) {
  const saved = loadPersistedSession();
  if (!saved) return null;
  try {
    return await zalo.login({
      imei: saved.imei,
      cookie: saved.cookies,
      userAgent: saved.userAgent,
      language: saved.language ?? ZALO_LANGUAGE,
    });
  } catch (error) {
    console.warn("[zca-js] 本地 Cookie 登录失败，将尝试扫码:", error?.message ?? error);
    return null;
  }
}

/** 使用回调在二维码生成瞬间写入内存与磁盘，避免仅依赖轮询 qr.png 时出现长时间 ready:false（库在未传 callback 时才会自动写文件）。 */
function handleLoginQrCallback(event) {
  if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
    qrBase64 = event.data.image ? String(event.data.image) : null;
    void event.actions.saveToFile(QR_FILE_PATH).catch((err) => {
      console.error("[zca-js] 保存二维码文件失败:", err);
    });
    console.log("[zca-js] 二维码已生成，可通过 /api/qr 获取");
  } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
    qrBase64 = null;
  }
}

/** 不在进程启动时登录；由首次 GET /api/qr 触发：先 Cookie，再 loginQR */
function startZaloBootstrapIfNeeded() {
  if (apiClient || zaloBootstrapPromise) return;
  zaloBootstrapPromise = bootstrapZalo()
    .then((api) => {
      apiClient = api;
      return api;
    })
    .catch((err) => {
      console.error("[zca-js] 登录流程失败:", err);
    })
    .finally(() => {
      if (!apiClient) zaloBootstrapPromise = null;
    });
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/** zca-js 走 fetch；连接超时/阻断时给出可操作提示 */
function mapZaloNetworkFailure(error) {
  const code = error?.cause?.code ?? error?.code ?? "";
  const name = error?.cause?.name ?? error?.name ?? "";
  if (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_SOCKET" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    name === "ConnectTimeoutError"
  ) {
    return {
      status: 503,
      message:
        "无法连接 Zalo 接口（超时或网络阻断）。请检查能否访问 chat.zalo.me，必要时配置 VPN；环境变量设置 ZALO_PROXY / HTTPS_PROXY（文档示例：HttpProxyAgent + node-fetch）。直连时可尝试增大 ZALO_FETCH_CONNECT_TIMEOUT_MS。",
    };
  }
  return null;
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
    if (!threadId || threadType === null || !msg) return json(res, 400, { ok: false, message: "参数不完整，必须提供 threadId、threadType(user/group)、msg" }), true;
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

/** 等待二维码生成回调落盘或 Cookie 登录设置 apiClient；登录任务已结束时提前退出 */
async function awaitQrOrLoginVisible() {
  const deadline = Date.now() + QR_HTTP_WAIT_MS;
  while (Date.now() < deadline) {
    if (apiClient) return;
    if (qrBase64) return;
    if (fs.existsSync(QR_FILE_PATH)) return;
    if (!zaloBootstrapPromise) return;
    await new Promise((r) => setTimeout(r, QR_HTTP_POLL_MS));
  }
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
    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "zca-js-echo",
        loggedIn: Boolean(apiClient),
        loginStarted: Boolean(apiClient || zaloBootstrapPromise),
        sessionFile: fs.existsSync(SESSION_FILE_PATH),
      });
    }
    if (req.method === "GET" && pathname === "/api/qr") {
      startZaloBootstrapIfNeeded();
      if (!apiClient && zaloBootstrapPromise) {
        await awaitQrOrLoginVisible();
      }
      if (apiClient) {
        return json(res, 200, {
          ok: true,
          loggedIn: true,
          ready: true,
          qrPath: "./qr.png",
          mimeType: "image/png",
          base64: null,
          dataUrl: null,
          message: "已登录，无需扫码",
        });
      }
      const currentBase64 = qrBase64 ?? loadQrAsBase64();
      const ready = Boolean(currentBase64);
      return json(res, ready ? 200 : 202, {
        ok: true,
        loggedIn: false,
        ready,
        qrPath: "./qr.png",
        mimeType: "image/png",
        base64: currentBase64,
        dataUrl: currentBase64 ? `data:image/png;base64,${currentBase64}` : null,
      });
    }

    try {
      if (await handleCommonApi(req, res, urlObj)) return;
    } catch (error) {
      console.error("[http] 接口调用失败:", error);
      const mapped = mapZaloNetworkFailure(error);
      if (mapped) return json(res, mapped.status, { ok: false, message: mapped.message });
      return json(res, 500, { ok: false, message: error?.message ?? "Internal Server Error" });
    }

    return json(res, 404, { ok: false, message: "Not Found" });
  });

  wss = new WebSocketServer({
    server,
    path: "/ws"
  });

  wss.on("connection", (ws, req) => {
    clients.add(ws);
    console.log(`[websocket] 客户端连接，当前连接数: ${clients.size}`);

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`[websocket] 客户端断开，当前连接数: ${clients.size}`);
    });

    ws.on("error", (error) => {
      console.error("[websocket] 错误:", error);
      clients.delete(ws);
    });
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[http] 健康检查: http://localhost:${HTTP_PORT}/health`);
    console.log(`[http] QR接口: http://localhost:${HTTP_PORT}/api/qr（首次访问时开始扫码登录）`);
    console.log(`[http] OpenAPI: http://localhost:${HTTP_PORT}/openapi.json`);
    console.log(`[http] Swagger UI: http://localhost:${HTTP_PORT}/docs`);
    console.log(`[http] WebSocket: ws://localhost:${HTTP_PORT}/ws`);
    console.log(`[http] 常用API前缀: http://localhost:${HTTP_PORT}/v1`);
    if (SWAGGER_AUTH_ENABLED) console.log("[http] Swagger 鉴权已启用（Basic Auth）");
    if (API_AUTH_ENABLED) console.log("[http] 业务接口鉴权已启用（Bearer Token）");
    if (ZALO_HTTP_PROXY) console.log(`[http] Zalo 代理（HttpProxyAgent + node-fetch）: ${maskProxyForLog(ZALO_HTTP_PROXY)}`);
    else console.log(`[http] Zalo 直连（node-fetch + 内置 Agent），socket 超时: ${ZALO_FETCH_CONNECT_TIMEOUT_MS}ms（ZALO_FETCH_CONNECT_TIMEOUT_MS）`);
  });

  return server;
}

async function bootstrapZalo() {
  const zalo = new Zalo(ZALO_CLIENT_OPTIONS);
  const qrOptions = { userAgent: ZALO_USER_AGENT, language: ZALO_LANGUAGE };

  let api = await tryLoginWithSavedSession(zalo);
  if (api) {
    console.log("[zca-js] 已使用本地会话（Cookie）登录");
    persistZaloSession(api);
    attachZaloMessageListener(api);
    return api;
  }

  console.log("[zca-js] 无有效本地会话，开始扫码登录…");
  const qrOptionsResolved = { ...qrOptions, qrPath: QR_FILE_PATH };
  api = await zalo.loginQR(qrOptionsResolved, handleLoginQrCallback);

  removeLocalQrAfterLogin();

  persistZaloSession(api);
  attachZaloMessageListener(api);
  return api;
}

async function main() {
  const server = startHttpServer();

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
