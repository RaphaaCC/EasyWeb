import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { createSiteSnapshotHandler } from "../src/handlers/site-snapshot-handler.js";

function createSnapshot() {
  return {
    captureVersion: 1,
    page: { origin: "https://example.com", path: "/products" },
    structure: {
      nodeCount: 3,
      truncated: false,
      tree: {
        tag: "main",
        landmark: true,
        children: [{ tag: "h1", headingLevel: 1 }, { tag: "a", interactive: true }],
        ignoredSensitiveText: "Ana Example"
      }
    },
    html: "<html><body><main><h1></h1><a></a></main></body></html>",
    css: "main { color: rgb(1, 2, 3); background-image: url(); }",
    styles: {
      styleSheetCount: 2,
      inlineStyleCount: 1,
      externalStyleSheetCount: 1,
      externalOrigins: ["https://cdn.example.com", "https://cdn.example.com"],
      colors: ["rgb(1, 2, 3)"],
      fontFamilies: ["Arial"],
      fontSizes: ["16px"],
      lineHeights: ["24px"],
      ignoredCss: "background: url(https://example.com/private.png)"
    },
    scripts: {
      total: 2,
      inlineCount: 1,
      externalCount: 1,
      moduleCount: 0,
      asyncCount: 0,
      deferCount: 1,
      externalOrigins: ["https://cdn.example.com"],
      sourceCode: "const token = 'secret';"
    },
    ignoredPayload: "não deve ser armazenado"
  };
}

test("armazena somente o snapshot sanitizado e comprimido", async () => {
  const calls = [];
  const handler = createSiteSnapshotHandler({
    database: {
      configured: true,
      query: async (statement, values) => calls.push({ statement, values })
    }
  });

  const result = await handler.store({
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7",
    snapshot: createSnapshot()
  });

  assert.equal(result.stored, true);
  assert.equal(calls.length, 1);
  const payload = JSON.parse(gunzipSync(calls[0].values[10]).toString("utf8"));
  assert.equal(payload.ignoredPayload, undefined);
  assert.equal(payload.structure.tree.ignoredSensitiveText, undefined);
  assert.equal(payload.styles.ignoredCss, undefined);
  assert.equal(payload.scripts.sourceCode, undefined);
  assert.equal(payload.html, "<html><body><main><h1></h1><a></a></main></body></html>");
  assert.equal(payload.css, "style{color:rgb(1, 2, 3)}");
  assert.deepEqual(payload.styles.externalOrigins, ["https://cdn.example.com"]);
});

test("rejeita caminho com parâmetros ou fragmentos", async () => {
  const handler = createSiteSnapshotHandler({ database: { configured: true, query: async () => undefined } });
  const snapshot = createSnapshot();
  snapshot.page.path = "/products?email=ana@example.com";

  await assert.rejects(
    handler.store({ installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7", snapshot }),
    { code: "EASYWEB_INVALID_SNAPSHOT" }
  );
});

test("remove identificadores dinâmicos do caminho antes de persistir", () => {
  const handler = createSiteSnapshotHandler();
  const snapshot = createSnapshot();
  snapshot.page.path = "/conta/ana%40example.com/pedido/123456";

  const prepared = handler.prepare({ installationId: "installation-123456", snapshot });

  assert.equal(prepared.normalized.page.path, "/conta/:private/pedido/:id");
});

test("filtra HTML e CSS sensíveis sem rejeitar um snapshot estrutural", async () => {
  const calls = [];
  const handler = createSiteSnapshotHandler({
    database: {
      configured: true,
      query: async (statement, values) => calls.push({ statement, values })
    }
  });
  const snapshot = createSnapshot();
  snapshot.html = [
    '<html><body><main class="account" data-user="ana@example.com">',
    '<form action="/login"><input type="password" value="secret"></form>',
    '<p>Conteúdo privado</p><script>window.token = "secret"</script>',
    '</main></body></html>'
  ].join("");
  snapshot.css = '@import url("https://private.example/style.css"); [data-account-id="ana@example.com"]#user-123456 { color: #123456; font-size: 16px; background-image: url(https://private.example/image.png); font-family: ana-private; content: "secret"; }';

  await handler.store({
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7",
    snapshot
  });

  const payload = JSON.parse(gunzipSync(calls[0].values[10]).toString("utf8"));
  assert.equal(payload.html, "<html><body><main><form><input></form><p></p></main></body></html>");
  assert.doesNotMatch(payload.html, /ana@example|secret|class|data-user|script/i);
  assert.doesNotMatch(payload.css, /@import|https:|private\.example/i);
  assert.equal(payload.css, "style{color:#123456;font-size:16px}");
  assert.doesNotMatch(payload.css, /ana@example|user-123456|data-account|private\.example|ana-private|secret|url\(/i);
});
