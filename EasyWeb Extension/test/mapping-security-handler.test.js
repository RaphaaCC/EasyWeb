const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHandler() {
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "handlers", "mapping-security-handler.js"), "utf8"),
    context
  );
  return context.EasyWebMappingSecurityHandler;
}

test("remove identificadores pessoais e dinâmicos do caminho do snapshot", () => {
  const handler = loadHandler();

  assert.equal(
    handler.sanitizePath("/conta/ana%40example.com/pedido/123456/sessao/0123456789abcdef0123456789abcdef"),
    "/conta/:private/pedido/:id/sessao/:private"
  );
  assert.equal(handler.sanitizePath("/artigos/acessibilidade-na-web"), "/artigos/acessibilidade-na-web");
});
