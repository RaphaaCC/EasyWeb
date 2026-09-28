const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readContentVersion(file) {
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(/const CONTENT_VERSION = (\d+);/);
  assert.ok(match, `CONTENT_VERSION ausente em ${file}`);
  return Number(match[1]);
}

test("mantém a versão de reinjeção sincronizada com o content script", () => {
  const content = readContentVersion(path.join(__dirname, "..", "src", "content.js"));
  const injection = readContentVersion(path.join(__dirname, "..", "src", "handlers", "content-injection-handler.js"));
  assert.equal(injection, content);
});
