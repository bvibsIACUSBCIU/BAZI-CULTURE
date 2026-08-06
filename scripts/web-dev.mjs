import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnv(path.join(rootDir, ".env"));

import { handleChatRequest } from "../api/chat.js";
import { handleAuthRequest } from "../api/auth.js";
import { handleProfileRequest } from "../api/profile.js";
import { handleQuotaRequest } from "../api/quota.js";
import { handleSessionHistoryRequest } from "../api/session-history.js";
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
  // CORS Headers
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const rawPath = (request.url || "/").split("?")[0];

  // API Routes
  if (rawPath.startsWith("/api/")) {
    try {
      const fullUrl = `http://${request.headers.host || "localhost:" + port}${request.url}`;
      
      // 读取 Body (如果是 POST/PUT)
      let reqBodyBuffer = null;
      if (request.method !== "GET" && request.method !== "HEAD") {
        reqBodyBuffer = await readBodyBuffer(request);
      }

      // 封装标准的 Fetch Request 对象
      const fetchReq = new Request(fullUrl, {
        method: request.method,
        headers: request.headers,
        body: reqBodyBuffer,
        duplex: "half"
      });

      // 路由匹配
      if (rawPath === "/api/chat") {
        const fetchRes = await handleChatRequest(fetchReq);
        response.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers.entries()));
        if (fetchRes.body) {
          const reader = fetchRes.body.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            response.write(value);
          }
        }
        response.end();
        return;
      }

      if (rawPath.startsWith("/api/auth")) {
        const fetchRes = await handleAuthRequest(fetchReq);
        await sendFetchResponse(fetchRes, response);
        return;
      }

      if (rawPath === "/api/profile") {
        const fetchRes = await handleProfileRequest(fetchReq);
        await sendFetchResponse(fetchRes, response);
        return;
      }

      if (rawPath === "/api/quota") {
        const fetchRes = await handleQuotaRequest(fetchReq);
        await sendFetchResponse(fetchRes, response);
        return;
      }

      if (rawPath === "/api/session-history" || rawPath.startsWith("/api/session-history/")) {
        const fetchRes = await handleSessionHistoryRequest(fetchReq);
        await sendFetchResponse(fetchRes, response);
        return;
      }

      if (rawPath === "/api/report") {
        const jsonBody = reqBodyBuffer ? JSON.parse(reqBodyBuffer.toString("utf8")) : {};
        await reportHandler({ method: request.method, body: jsonBody }, createFunctionResponse(response));
        return;
      }

      if (rawPath === "/api/ai-report") {
        const jsonBody = reqBodyBuffer ? JSON.parse(reqBodyBuffer.toString("utf8")) : {};
        await aiReportHandler({ method: request.method, body: jsonBody }, createFunctionResponse(response));
        return;
      }

      if (rawPath === "/api/events") {
        const jsonBody = reqBodyBuffer ? JSON.parse(reqBodyBuffer.toString("utf8")) : {};
        await eventsHandler({ method: request.method, body: jsonBody }, createFunctionResponse(response));
        return;
      }

      if (rawPath === "/api/ziwei") {
        const jsonBody = reqBodyBuffer ? JSON.parse(reqBodyBuffer.toString("utf8")) : {};
        await ziweiHandler({ method: request.method, url: request.url, body: jsonBody }, createFunctionResponse(response));
        return;
      }

      if (rawPath === "/api/qimen") {
        const jsonBody = reqBodyBuffer ? JSON.parse(reqBodyBuffer.toString("utf8")) : {};
        await qimenHandler({ method: request.method, url: request.url, body: jsonBody }, createFunctionResponse(response));
        return;
      }
    } catch (err) {
      console.error("API handler error:", err);
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR", message: err.message }));
      return;
    }
  }

  // 静态资源处理
  let relativePath = rawPath === "/" ? "app.html" : rawPath.slice(1);
  let filePath = path.join(rootDir, relativePath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // 默认回退 app.html
    filePath = path.join(rootDir, "app.html");
  }

  if (fs.existsSync(filePath)) {
    try {
      const content = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon"
      };
      response.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
      response.end(content);
      return;
    } catch (err) {
      console.error("Static file error:", err);
    }
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Bazi research MVP dev server running at: http://127.0.0.1:${port}`);
  console.log(`Workstation entry: http://127.0.0.1:${port}/app.html`);
});

async function readBodyBuffer(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 500_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function sendFetchResponse(fetchRes, nodeRes) {
  const headers = Object.fromEntries(fetchRes.headers.entries());
  nodeRes.writeHead(fetchRes.status, headers);
  if (typeof fetchRes.json === "function" && !fetchRes.body) {
    const json = await fetchRes.json();
    nodeRes.end(JSON.stringify(json));
  } else if (fetchRes.body) {
    const reader = fetchRes.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      nodeRes.write(value);
    }
    nodeRes.end();
  } else {
    const text = await fetchRes.text();
    nodeRes.end(text);
  }
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
      response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(payload));
    },
  };
}
