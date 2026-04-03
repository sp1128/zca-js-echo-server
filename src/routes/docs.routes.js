import fs from "node:fs";
import path from "node:path";
import swaggerUiDist from "swagger-ui-dist";
import { openapiDocument } from "../docs/openapi.js";
import { runtime, loadQrAsBase64 } from "../services/runtime.js";
import { json } from "../utils/http.js";

const SWAGGER_DIST_DIR = swaggerUiDist.getAbsoluteFSPath();

function swaggerHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>ZCA JS API Docs</title><link rel="stylesheet" type="text/css" href="/docs/swagger-ui.css" /></head><body><div id="swagger-ui"></div><script src="/docs/swagger-ui-bundle.js"></script><script src="/docs/swagger-ui-standalone-preset.js"></script><script>window.onload=function(){window.ui=SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',deepLinking:true,presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:'StandaloneLayout'})};</script></body></html>`;
}

export function handleDocsRoute(req, res, pathname) {
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
    const contentTypeMap = {
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".html": "text/html; charset=utf-8",
      ".map": "application/json; charset=utf-8",
    };

    res.writeHead(200, { "Content-Type": contentTypeMap[ext] ?? "application/octet-stream" });
    fs.createReadStream(absolutePath).pipe(res);
    return true;
  }

  if (pathname === "/openapi.json") {
    json(res, 200, openapiDocument);
    return true;
  }

  if (pathname === "/api/qr") {
    const currentBase64 = runtime.qrBase64 ?? loadQrAsBase64();
    const ready = Boolean(currentBase64);
    json(res, ready ? 200 : 202, {
      ok: true,
      ready,
      qrPath: "./qr.png",
      mimeType: "image/png",
      base64: currentBase64,
      dataUrl: currentBase64 ? `data:image/png;base64,${currentBase64}` : null,
    });
    return true;
  }

  return false;
}