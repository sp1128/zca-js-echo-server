import "dotenv/config";
import http from "node:http";
import { config, flags } from "./config.js";
import { handleDocsRoute } from "./routes/docs.routes.js";
import { handleApiRoute } from "./routes/api.routes.js";
import { bootstrapZalo, runtime } from "./services/runtime.js";
import { isSwaggerAuthorized, unauthorized } from "./middlewares/auth.js";
import { json } from "./utils/http.js";

function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = urlObj.pathname;

    const isDocsRoute =
      req.method === "GET" &&
      (pathname === "/docs" ||
        pathname === "/docs/" ||
        pathname.startsWith("/docs/") ||
        pathname === "/openapi.json" ||
        pathname === "/api/qr");

    if (isDocsRoute && !isSwaggerAuthorized(req)) return unauthorized(res, "basic");

    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "zca-js-ai-employee",
        loggedIn: Boolean(runtime.apiClient),
      });
    }

    if (req.method === "GET" && handleDocsRoute(req, res, pathname)) return;

    try {
      if (await handleApiRoute(req, res, pathname, urlObj)) return;
    } catch (error) {
      console.error("[http] 接口调用失败:", error);
      return json(res, 500, { ok: false, message: error?.message ?? "Internal Server Error" });
    }

    return json(res, 404, { ok: false, message: "Not Found" });
  });

  server.listen(config.httpPort, () => {
    console.log(`[http] 健康检查: http://localhost:${config.httpPort}/health`);
    console.log(`[http] QR接口: http://localhost:${config.httpPort}/api/qr`);
    console.log(`[http] OpenAPI: http://localhost:${config.httpPort}/openapi.json`);
    console.log(`[http] Swagger UI: http://localhost:${config.httpPort}/docs`);
    console.log(`[http] API前缀: http://localhost:${config.httpPort}/v1`);
    if (flags.swaggerAuthEnabled) console.log("[http] Swagger 鉴权已启用（Basic Auth）");
    if (flags.apiAuthEnabled) console.log("[http] 业务接口鉴权已启用（Bearer Token）");
  });

  return server;
}

async function main() {
  const server = startHttpServer();
  await bootstrapZalo();

  const shutdown = () => {
    try {
      runtime.apiClient?.listener?.stop?.();
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