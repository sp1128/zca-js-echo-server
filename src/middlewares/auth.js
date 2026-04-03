import { config, flags } from "../config.js";
import { json } from "../utils/http.js";

export function unauthorized(res, type = "basic") {
  if (type === "basic") {
    res.writeHead(401, {
      "Content-Type": "application/json; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="Swagger Docs"',
    });
    res.end(JSON.stringify({ ok: false, message: "Unauthorized" }));
    return;
  }

  json(res, 401, { ok: false, message: "Unauthorized" });
}

export function isSwaggerAuthorized(req) {
  if (!flags.swaggerAuthEnabled) return true;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Basic ")) return false;

  try {
    const decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf-8");
    const idx = decoded.indexOf(":");
    if (idx === -1) return false;
    return decoded.slice(0, idx) === config.swaggerUsername && decoded.slice(idx + 1) === config.swaggerPassword;
  } catch {
    return false;
  }
}

export function isApiAuthorized(req) {
  if (!flags.apiAuthEnabled) return true;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice(7).trim() === config.apiToken;
}
