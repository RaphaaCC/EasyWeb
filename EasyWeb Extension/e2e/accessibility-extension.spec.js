const { createServer } = require("node:http");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect, chromium } = require("@playwright/test");

const extensionPath = path.resolve(__dirname, "..");
let server;
let origin;
let context;
let worker;

function pageHtml() {
  return `<!doctype html>
  <html lang="pt-BR">
    <head><meta charset="utf-8"><title>Pagina de teste</title></head>
    <body>
      <main>
        <h1>Conteudo para leitura</h1>
        <p id="copy">Uma pagina local para verificar acessibilidade.</p>
        <a id="main-link" href="#details">Abrir detalhes</a>
        <button id="replace-head" type="button">Atualizar pagina</button>
      </main>
      <script>
        document.querySelector('#replace-head').addEventListener('click', () => {
          document.head.replaceChildren(Object.assign(document.createElement('title'), { textContent: 'Pagina atualizada' }));
          const link = document.createElement('a');
          link.id = 'dynamic-link'; link.href = '#dynamic'; link.textContent = 'Link adicionado dinamicamente';
          document.querySelector('main').append(link);
        });
      </script>
    </body>
  </html>`;
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(pageHtml());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "easyweb-playwright-"));
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10_000 });
  await worker.evaluate(() => chrome.storage.local.set({
    "easyweb:active-profile": "elderly",
    "easyweb:operation-mode": "standard"
  }));
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((resolve) => server?.close(resolve));
});

test("aplica o perfil global e preserva os ajustes depois de uma atualização dinâmica", async () => {
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });

  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("easyweb-enabled"))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("easyweb-contrast"))).toBe(true);
  await expect.poll(() => page.locator("#copy").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(16);

  await page.locator("#replace-head").click();
  await expect(page.locator("#dynamic-link")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("easyweb-contrast"))).toBe(true);
  await expect.poll(() => page.locator("#dynamic-link").getAttribute("data-easyweb-link")).toBe("true");
  await page.close();
});

test("aplica imediatamente um plano pessoal para controles maiores", async () => {
  await worker.evaluate(() => chrome.storage.local.set({
    "easyweb:active-profile": "elderly",
    "easyweb:operation-mode": "enhanced",
    "easyweb:ai-recommendations-enabled": true
  }));
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const plan = {
    schemaVersion: 1,
    planId: "personal:e2e:large-controls",
    planScope: "personal",
    origin,
    profile: "elderly",
    siteScript: {
      version: 1,
      triggers: ["document-ready"],
      steps: [{
        type: "apply-style",
        target: "controls",
        preset: "large-controls",
        parameters: { minimumSize: 48 }
      }]
    }
  };

  const response = await worker.evaluate(async ({ pageUrl, plan: value }) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === pageUrl);
    return chrome.tabs.sendMessage(tab.id, {
      type: "easyweb:apply-ai-personal-plan",
      plan: value,
      profileId: "elderly"
    });
  }, { pageUrl: page.url(), plan });

  assert.equal(response.appliedImmediately, true);
  await expect.poll(() => page.locator("#replace-head").evaluate((element) => {
    const style = getComputedStyle(element);
    return { minHeight: Number.parseFloat(style.minHeight), paddingInline: Number.parseFloat(style.paddingInlineStart) };
  })).toMatchObject({ minHeight: 48 });
  await expect.poll(() => page.locator("#replace-head").evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).paddingInlineStart)
  )).toBeGreaterThanOrEqual(10);
  await page.close();
});

test("mantém a página de configurações navegável na versão beta", async () => {
  await worker.evaluate(() => chrome.storage.local.set({
    "easyweb:active-profile": "elderly",
    "easyweb:operation-mode": "standard"
  }));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.locator("#profile-grid .profile-card")).toHaveCount(9);
  await expect(page.locator("footer")).toContainText("v1.0.1 Beta");
  await expect(page.locator(".api-section")).toBeHidden();

  await page.locator('input[name="operation-mode"][value="enhanced"]').check();
  await expect(page.locator(".api-section")).toBeVisible();
  await expect(page.locator(".mapping-section")).toBeVisible();
  await expect(page.locator(".ai-section")).toBeVisible();
  await page.close();
});
