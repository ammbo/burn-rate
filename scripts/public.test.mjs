import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const origin = process.env.PUBLIC_TEST_ORIGIN || "http://localhost:8787";
const publicPaths = ["/", "/about", "/how-it-works", "/privacy", "/terms"];

test("public pages ship unique metadata, crawlable copy, and valid structured data", async () => {
  const descriptions = new Set();
  for (const path of publicPaths) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const html = await response.text();
    assert.ok(html.includes(`rel="canonical" href="https://burnrating.com${path}"`), path);
    assert.ok(html.includes(`property="og:url" content="https://burnrating.com${path}"`), path);
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /property="og:image:height" content="630"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /name="robots" content="index, follow, max-image-preview:large"/);
    descriptions.add(html.match(/name="description" content="([^"]+)"/)[1]);
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.ok(data["@graph"].some((item) => item["@type"] === "WebSite"));
    assert.match(html, /<h1(?:\s[^>]*)?>/);
    assert.match(html, /support@burnrateagents.com|href="\/about"/);
    assert.match(html, /href="\/privacy"/);
    assert.match(html, /href="\/terms"/);
    assert.match(html, /sandbox/i);
  }
  assert.equal(descriptions.size, publicPaths.length);
});

test("discovery files advertise only real public documents", async () => {
  const response = await fetch(`${origin}/sitemap.xml`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /xml/);
  const xml = await response.text();
  assert.deepEqual([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]), publicPaths.map((path) => `https://burnrating.com${path}`).sort((a, b) => {
    const order = ["/", "/how-it-works", "/about", "/privacy", "/terms"];
    return order.indexOf(new URL(a).pathname) - order.indexOf(new URL(b).pathname);
  }));
  assert.doesNotMatch(xml, /#|\/api|\/404/);
  assert.match(await (await fetch(`${origin}/robots.txt`)).text(), /Disallow: \/api\/\n/);
  assert.match(await (await fetch(`${origin}/llms.txt`)).text(), /test funds only/);
  const image = await fetch(`${origin}/assets/og-burn-rate.png`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /image\/png/);
});

test("missing routes return a branded, non-indexable 404 including HEAD", async () => {
  for (const method of ["GET", "HEAD"]) {
    for (const path of ["/missing-public-page", "/assets/missing.png"]) {
      const response = await fetch(`${origin}${path}`, { method });
      assert.equal(response.status, 404);
      assert.match(response.headers.get("x-robots-tag"), /noindex/);
      if (method === "GET") assert.match(await response.text(), /This one|Page not found/);
    }
  }
});

test("HTML aliases resolve to the same canonical public page", async () => {
  for (const path of ["/about/", "/about.html", "/index.html"]) {
    const response = await fetch(`${origin}${path}`, { redirect: "manual" });
    assert.ok([301, 302, 307, 308].includes(response.status), path);
    const target = new URL(response.headers.get("location"), origin);
    assert.equal(target.pathname, path === "/index.html" ? "/" : "/about");
  }
});

test("API responses are not cached or indexed", async () => {
  const response = await fetch(`${origin}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
});

test("public marketing copy reserves the hackathon disclosure for policies and the composer", async () => {
  for (const path of ["/", "/about", "/how-it-works", "/llms.txt", "/site-content.js"]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /hackathon/i, path);
  }
  for (const path of ["/privacy", "/terms", "/app.js"]) {
    assert.match(await (await fetch(`${origin}${path}`)).text(), /hackathon/i, path);
  }
});

test("visitors can browse but cannot start generation without access", async () => {
  assert.equal((await (await fetch(`${origin}/api/session`)).json()).authenticated, false);
  const response = await fetch(`${origin}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ category: "image", brief: "An anonymous generation should never start", offer: 2, mode: "house" }) });
  assert.equal(response.status, 401);
});

test("PayPal loader ignores named DOM elements and permits retry after SDK failure", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const functionSource = source.slice(source.indexOf("function loadPaypal("), source.indexOf("async function mountPaypal("));
  const scripts = [];
  const context = vm.createContext({
    window: { paypal: { tagName: "DIV" } },
    document: {
      createElement: () => ({ remove() {} }),
      head: { appendChild: (script) => scripts.push(script) },
    },
    encodeURIComponent,
  });
  vm.runInContext(`let paypalPromise = null; ${functionSource}`, context);
  const failed = vm.runInContext('loadPaypal("sandbox-client")', context);
  assert.equal(scripts.length, 1, "a named DOM property must not short-circuit the SDK load");
  scripts[0].onerror();
  await assert.rejects(failed, /checkout didn’t load/);
  const loaded = vm.runInContext('loadPaypal("sandbox-client")', context);
  assert.equal(scripts.length, 2, "failed SDK loads must be retryable");
  context.window.paypal = { Buttons() {} };
  scripts[1].onload();
  await loaded;
  await vm.runInContext('loadPaypal("sandbox-client")', context);
  assert.equal(scripts.length, 2, "a loaded SDK must be reused");
});
