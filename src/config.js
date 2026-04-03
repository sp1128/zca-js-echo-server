import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export const config = {
  echoPrefix: process.env.ECHO_PREFIX ?? "echo: ",
  onlyReplyPrefix: process.env.ONLY_REPLY_PREFIX ?? "",
  httpPort: Number(process.env.PORT ?? 3000),
  swaggerUsername: process.env.SWAGGER_USERNAME ?? "",
  swaggerPassword: process.env.SWAGGER_PASSWORD ?? "",
  apiToken: process.env.API_TOKEN ?? "",
  qrFilePath: path.resolve(projectRoot, "qr.png"),
};

export const flags = {
  swaggerAuthEnabled: Boolean(config.swaggerUsername && config.swaggerPassword),
  apiAuthEnabled: Boolean(config.apiToken),
};
