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


test("remove seletores, identificadores e strings arbitrárias do CSS estrutural", () => {
  const handler = loadHandler();
  const sanitized = handler.sanitizeCss([
    '[data-account-id="ana@example.com"], #user-123456, .session-private {',
    '  color: rgb(1, 2, 3);',
    '  font-size: 16px;',
    '  background-image: url(https://private.example/image.png);',
    '  font-family: ana-private;',
    '  content: "segredo";',
    '}',
    '@media (min-width: 600px) {',
    '  a[href="/conta/123456"] { line-height: 1.5; padding: 8px 12px; }',
    '}'
  ].join("\n"));

  assert.doesNotMatch(sanitized, /ana@example|user-123456|session-private|data-account|href|conta|123456|private\.example|segredo|font-family/i);
  assert.match(sanitized, /color:rgb\(1, 2, 3\)/);
  assert.match(sanitized, /font-size:16px/);
  assert.match(sanitized, /line-height:1.5/);
  assert.match(sanitized, /padding:8px 12px/);
});
