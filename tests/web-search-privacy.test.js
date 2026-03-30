const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FRONTEND_DIR = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(FRONTEND_DIR, "shell.js"), "utf8");

function extractFunctionSource(name) {
  const signature = `function ${name}(`;
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`Could not find function ${name}`);
  }

  let braceIndex = source.indexOf("{", start);
  let depth = 0;
  let end = braceIndex;
  for (; end < source.length; end += 1) {
    const char = source[end];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

function loadPrivateSearchHelpers() {
  const context = {
    URL,
    Event: function Event(type, init) {
      this.type = type;
      this.bubbles = Boolean(init && init.bubbles);
    }
  };
  const script = [
    "function cleanText(value) { return String(value == null ? '' : value).trim(); }",
    extractFunctionSource("isDuckDuckGoHost"),
    extractFunctionSource("extractPrivateSearchDetails"),
    extractFunctionSource("resolveVisibleWebUri"),
    extractFunctionSource("findPrivateSearchField"),
    extractFunctionSource("submitPrivateSearchFromFrame"),
    "this.extractPrivateSearchDetails = extractPrivateSearchDetails;",
    "this.resolveVisibleWebUri = resolveVisibleWebUri;",
    "this.submitPrivateSearchFromFrame = submitPrivateSearchFromFrame;"
  ].join("\n\n");

  vm.runInNewContext(script, context, { filename: "web-search-privacy-helpers.js" });
  return context;
}

test("resolveVisibleWebUri keeps DuckDuckGo queries out of the shell address bar", () => {
  const { resolveVisibleWebUri } = loadPrivateSearchHelpers();
  const tab = {
    searchProvider: "",
    searchQuery: ""
  };

  const visibleUrl = resolveVisibleWebUri(tab, "https://duckduckgo.com/?q=best+horror+games&t=ffab");

  assert.equal(visibleUrl, "https://duckduckgo.com/");
  assert.equal(tab.searchProvider, "duckduckgo");
  assert.equal(tab.searchQuery, "best horror games");
});

test("resolveVisibleWebUri leaves normal destinations unchanged", () => {
  const { resolveVisibleWebUri } = loadPrivateSearchHelpers();
  const tab = {
    searchProvider: "",
    searchQuery: ""
  };

  const visibleUrl = resolveVisibleWebUri(tab, "https://example.com/docs");

  assert.equal(visibleUrl, "https://example.com/docs");
  assert.equal(tab.searchProvider, "");
  assert.equal(tab.searchQuery, "");
});

test("submitPrivateSearchFromFrame populates the proxied search form before submitting", () => {
  const { submitPrivateSearchFromFrame } = loadPrivateSearchHelpers();
  const dispatchedEvents = [];
  let requestSubmitCalls = 0;
  const attributes = {};
  let focused = false;

  const field = {
    form: {
      requestSubmit() {
        requestSubmitCalls += 1;
      }
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    dispatchEvent(event) {
      dispatchedEvents.push(event.type);
      return true;
    },
    focus() {
      focused = true;
    },
    value: ""
  };

  const frame = {
    contentDocument: {
      querySelector(selector) {
        if (selector.indexOf('input[name="q"]') !== -1) {
          return field;
        }
        return null;
      }
    }
  };

  assert.equal(submitPrivateSearchFromFrame(frame, "proxy privacy"), true);
  assert.equal(field.value, "proxy privacy");
  assert.equal(attributes.value, "proxy privacy");
  assert.equal(focused, true);
  assert.deepEqual(dispatchedEvents, ["input", "change"]);
  assert.equal(requestSubmitCalls, 1);
});
