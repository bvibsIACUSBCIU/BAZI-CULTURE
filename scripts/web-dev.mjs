import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnv(path.join(rootDir, ".env"));

import reportHandler from "../api/report.js";
import aiReportHandler from "../api/ai-report.js";
import eventsHandler from "../api/events.js";
import ziweiHandler from "../api/ziwei.js";
import qimenHandler from "../api/qimen.js";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const val = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const port = Number(process.env.PORT || 4173);

const server = createServer(async (request, response) => {
  if (
    request.url === "/api/report" ||
    request.url === "/api/ai-report" ||
    request.url === "/api/events" ||
    request.url === "/api/ziwei" ||
    request.url === "/api/qimen"
  ) {
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    const selectedHandler = {
      "/api/report": reportHandler,
      "/api/ai-report": aiReportHandler,
      "/api/events": eventsHandler,
      "/api/ziwei": ziweiHandler,
      "/api/qimen": qimenHandler,
    }[request.url];
    await selectedHandler(
      { method: request.method, body },
      createFunctionResponse(response),
    );
    return;
  }

  if (request.url === "/" || request.url === "/index.html") {
    const html = await readFile(path.join(rootDir, "index.html"));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }

  const staticPages = new Map([
    ["/systems.html", "systems.html"],
    ["/ziwei.html", "ziwei.html"],
    ["/qimen.html", "qimen.html"],
    ["/system-page.css", "system-page.css"],
    ["/ziwei-page.js", "ziwei-page.js"],
    ["/qimen-page.js", "qimen-page.js"],
    ["/systems-workspace.css", "systems-workspace.css"],
  ]);
  if (staticPages.has(request.url)) {
    const fileName = staticPages.get(request.url);
    const body = await readFile(path.join(rootDir, fileName));
    const contentType = fileName.endsWith(".css")
      ? "text/css; charset=utf-8"
      : fileName.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "text/html; charset=utf-8";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(body);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Bazi research MVP: http://127.0.0.1:${port}`);
});

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 16_384) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createFunctionResponse(response) {
  let statusCode = 200;
  return {
    setHeader(name, value) {
      response.setHeader(name, value);
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      response.writeHead(statusCode);
      response.end(JSON.stringify(payload));
    },
  };
}
