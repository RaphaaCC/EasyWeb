const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadBackground() {
  const storage = Object.assign(Object.create(null), {
    "easyweb:operation-mode": "enhanced"
  });
  const sockets = [];
  const tabMessages = [];
  let messageListener;
  let clock = 1_000_000;

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }

    static now() {
      return clock;
    }
  }

  class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.listeners = new Map();
      this.sent = [];
      sockets.push(this);
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) {
        listener(event);
      }
    }

    send(value) {
      if (this.readyState !== FakeWebSocket.OPEN) {
        throw new Error("Socket fechado.");
      }
      this.sent.push(JSON.parse(value));
    }

    close() {
      this.readyState = 3;
    }
  }

  const local = {
    async get(keys) {
      if (keys === null) return { ...storage };
      const names = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys || {});
      return Object.fromEntries(names.map((key) => [key, storage[key]]));
    },
    async set(values) {
      Object.assign(storage, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
    }
  };

  const context = {
    URL,
    TextEncoder,
    Promise,
    Map,
    Set,
    Date: FakeDate,
    Math,
    Number,
    Boolean,
    Object,
    Array,
    String,
    RegExp,
    Error,
    crypto: require("node:crypto").webcrypto,
    WebSocket: FakeWebSocket,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    chrome: {
      runtime: {
        getManifest: () => ({ version_name: "0.1.0-development" }),
        onMessage: { addListener(listener) { messageListener = listener; } },
        onStartup: { addListener() {} }
      },
      storage: { local, onChanged: { addListener() {} } },
      tabs: {
        async sendMessage(tabId, message) {
          tabMessages.push({ tabId, message });
          return { received: true };
        },
        async query() {
          return [];
        }
      },
      scripting: {}
    }
  };
  context.globalThis = context;
  context.importScripts = (...files) => {
    for (const file of files) {
      vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8"),
        context,
        { filename: file }
      );
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8"),
    context,
    { filename: "background.js" }
  );

  async function dispatch(message) {
    return new Promise((resolve) => {
      const keepAlive = messageListener(message, {
        tab: { id: 10 },
        url: "https://example.com/"
      }, resolve);
      assert.equal(keepAlive, true);
    });
  }

  return {
    storage,
    sockets,
    tabMessages,
    dispatch,
    FakeWebSocket,
    advance(milliseconds) {
      clock += milliseconds;
    }
  };
}

async function openAndHandshake(harness) {
  const socket = harness.sockets[0];
  socket.readyState = harness.FakeWebSocket.OPEN;
  socket.emit("open");
  await settle();
  assert.equal(socket.sent.filter((item) => item.type === "easyweb:hello").length, 1);
  socket.emit("message", {
    data: JSON.stringify({ type: "easyweb:hello", protocolVersion: 1 })
  });
  await settle();
  return socket;
}

test("revalida um template confirmado quando a observação fica antiga", async () => {
  const harness = loadBackground();
  await settle();
  const socket = await openAndHandshake(harness);

  const fingerprint = "a".repeat(64);
  const snapshot = {
    page: { origin: "https://example.com", path: "/" },
    templateFingerprint: fingerprint
  };
  const firstCaptureId = "11111111-1111-4111-8111-111111111111";
  const first = await harness.dispatch({
    type: "easyweb:mapping:snapshot",
    snapshot,
    captureId: firstCaptureId
  });
  assert.equal(first.accepted, true);
  assert.equal(first.state, "sending");

  const firstEnvelope = socket.sent.find((item) => item.type === "easyweb:mapping:snapshot");
  socket.emit("message", {
    data: JSON.stringify({ type: "easyweb:mapping:stored", snapshotId: firstEnvelope.snapshotId })
  });
  await settle();

  const confirmationKey = "easyweb:mapping-confirmed-template:https://example.com";
  assert.equal(harness.storage[confirmationKey][0].template, `/:${fingerprint}`);
  assert.equal(typeof harness.storage[confirmationKey][0].lastStoredAt, "number");
  assert.equal(harness.tabMessages.at(-1).message.status.captureId, firstCaptureId);

  const recent = await harness.dispatch({
    type: "easyweb:mapping:snapshot",
    snapshot,
    captureId: "22222222-2222-4222-8222-222222222222"
  });
  assert.equal(recent.state, "checking-adaptation");
  assert.equal(recent.confirmedAt, harness.storage[confirmationKey][0].lastStoredAt);
  assert.equal(socket.sent.filter((item) => item.type === "easyweb:mapping:snapshot").length, 1);

  harness.storage[confirmationKey][0].lastStoredAt = 0;
  harness.advance(3_000);
  const stale = await harness.dispatch({
    type: "easyweb:mapping:snapshot",
    snapshot,
    captureId: "33333333-3333-4333-8333-333333333333"
  });
  assert.equal(stale.state, "sending");
  assert.equal(socket.sent.filter((item) => item.type === "easyweb:mapping:snapshot").length, 2);
});

test("consulta uma adaptação existente sem exigir um novo snapshot", async () => {
  const harness = loadBackground();
  await settle();
  const socket = await openAndHandshake(harness);

  const first = await harness.dispatch({
    type: "easyweb:adaptation:lookup",
    origin: "https://example.com"
  });
  assert.equal(first.accepted, true);
  assert.equal(first.state, "checking-adaptation");
  assert.equal(socket.sent.filter((item) => item.type === "easyweb:adaptation:lookup").length, 1);

  const repeated = await harness.dispatch({
    type: "easyweb:adaptation:lookup",
    origin: "https://example.com"
  });
  assert.equal(repeated.accepted, true);
  assert.equal(socket.sent.filter((item) => item.type === "easyweb:adaptation:lookup").length, 1);

  harness.advance(20_000);
  await harness.dispatch({
    type: "easyweb:adaptation:lookup",
    origin: "https://example.com"
  });
  assert.equal(socket.sent.filter((item) => item.type === "easyweb:adaptation:lookup").length, 2);
});

test("waits for the API handshake before releasing an adaptation lookup", async () => {
  const harness = loadBackground();
  await settle();
  const socket = harness.sockets[0];
  socket.readyState = harness.FakeWebSocket.OPEN;
  socket.emit("open");
  await settle();

  await harness.dispatch({
    type: "easyweb:adaptation:lookup",
    origin: "https://example.com"
  });
  assert.equal(socket.sent.filter((item) => item.type === "easyweb:adaptation:lookup").length, 0);

  socket.emit("message", {
    data: JSON.stringify({ type: "easyweb:hello", protocolVersion: 1 })
  });
  await settle();
  assert.equal(socket.sent.filter((item) => item.type === "easyweb:adaptation:lookup").length, 1);
});

test("retries an adaptation lookup immediately after an API error", async () => {
  const harness = loadBackground();
  await settle();
  const socket = await openAndHandshake(harness);

  await harness.dispatch({
    type: "easyweb:adaptation:lookup",
    origin: "https://example.com"
  });
  assert.equal(socket.sent.filter((item) => item.type === "easyweb:adaptation:lookup").length, 1);

  socket.emit("message", {
    data: JSON.stringify({
      type: "easyweb:adaptation:error",
      origin: "https://example.com",
      reason: "Temporary lookup failure."
    })
  });
  await settle();

  await harness.dispatch({
    type: "easyweb:adaptation:lookup",
    origin: "https://example.com"
  });
  assert.equal(socket.sent.filter((item) => item.type === "easyweb:adaptation:lookup").length, 2);
});
