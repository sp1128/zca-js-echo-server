const qrResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    ready: { type: "boolean" },
    qrPath: { type: "string" },
    mimeType: { type: "string" },
    base64: { type: ["string", "null"] },
    dataUrl: { type: ["string", "null"] },
  },
};

export const openapiDocument = {
  openapi: "3.0.3",
  info: {
    title: "ZCA JS AI Employee Service API",
    version: "1.3.0",
    description: "模块化后的 AI 员工社交中台 API",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "System", description: "系统状态" },
    { name: "Docs", description: "文档与二维码" },
    { name: "Profile", description: "账号资料" },
    { name: "Social", description: "好友与社交关系" },
    { name: "Messaging", description: "消息动作" },
    { name: "Groups", description: "群组动作" },
  ],
  components: {
    securitySchemes: {
      basicAuth: { type: "http", scheme: "basic" },
      bearerToken: { type: "http", scheme: "bearer" },
    },
  },
  paths: {
    "/health": { get: { tags: ["System"], summary: "健康检查", responses: { 200: { description: "OK" } } } },
    "/docs": { get: { tags: ["Docs"], summary: "Swagger UI", security: [{ basicAuth: [] }], responses: { 200: { description: "OK" } } } },
    "/openapi.json": { get: { tags: ["Docs"], summary: "OpenAPI JSON", security: [{ basicAuth: [] }], responses: { 200: { description: "OK" } } } },
    "/api/qr": { get: { tags: ["Docs"], summary: "获取登录二维码", security: [{ basicAuth: [] }], responses: { 200: { description: "OK", content: { "application/json": { schema: qrResponseSchema } } } } } },

    "/v1/profile": { get: { tags: ["Profile"], summary: "获取账号信息", security: [{ bearerToken: [] }], responses: { 200: { description: "OK" } } } },
    "/v1/friends": { get: { tags: ["Social"], summary: "好友列表", security: [{ bearerToken: [] }], responses: { 200: { description: "OK" } } } },
    "/v1/groups": { get: { tags: ["Groups"], summary: "群列表", security: [{ bearerToken: [] }], responses: { 200: { description: "OK" } } } },
    "/v1/messages": { post: { tags: ["Messaging"], summary: "发送文本消息", security: [{ bearerToken: [] }], responses: { 200: { description: "OK" } } } },
  },
};
