import { createServer } from "node:http";

/**
 * A stand-in for Mailjet's Send API, for the end-to-end suite.
 *
 * Accepts the same request the real API does, answers the way the real API
 * answers, and remembers what it was sent so a test can read it back. Nothing
 * leaves this process. Port and behaviour are deliberately dumb: the point is
 * to exercise GatherFlow's side of the exchange, not to model Mailjet.
 *
 *   POST /v3.1/send   accept a message; respond as Mailjet would
 *   GET  /sent        every message accepted so far
 *   DELETE /sent      forget them
 *   GET  /healthz     readiness, for Playwright's webServer check
 */
const PORT = Number(process.env.STUB_MAILJET_PORT ?? 3611);

let sent = [];
let nextId = 1000;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    return json(response, 200, { ok: true });
  }
  if (request.method === "GET" && url.pathname === "/sent") {
    return json(response, 200, sent);
  }
  if (request.method === "DELETE" && url.pathname === "/sent") {
    sent = [];
    return json(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/v3.1/send") {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      if (!/^Basic /.test(request.headers.authorization ?? "")) {
        return json(response, 401, { ErrorMessage: "Unauthorized" });
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json(response, 400, { ErrorMessage: "Malformed JSON" });
      }
      const messages = Array.isArray(body?.Messages) ? body.Messages : [];
      const results = messages.map((message) => {
        const id = nextId++;
        const uuid = `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
        sent.push({
          receivedAt: new Date().toISOString(),
          messageId: id,
          messageUuid: uuid,
          message,
        });
        return {
          Status: "success",
          CustomID: message.CustomID ?? "",
          To: (message.To ?? []).map((to) => ({
            Email: to.Email,
            MessageUUID: uuid,
            MessageID: id,
            MessageHref: `https://api.mailjet.com/v3/REST/message/${id}`,
          })),
          Cc: [],
          Bcc: [],
        };
      });
      return json(response, 200, { Messages: results });
    });
    return;
  }

  json(response, 404, { ErrorMessage: "Not found" });
});

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`stub mailjet listening on http://localhost:${PORT}`);
});
