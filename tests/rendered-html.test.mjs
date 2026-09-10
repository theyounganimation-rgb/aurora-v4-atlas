import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ATLAS_WORLD,
  MIN_ZOOM,
  constrainCenter,
  maximumZoom,
  panCamera,
  viewFor,
  zoomRequiredToCenter,
} from "../app/atlas-camera.mjs";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished Aurora atlas", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Aurora V4 Architecture Atlas<\/title>/i);
  assert.match(html, /How to read the atlas/);
  assert.match(html, /The voice path/);
  assert.match(html, /Start with the conductor/);
  assert.match(html, /Migration bridges/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton|codex-preview/);
});

test("camera bounds are finite and idempotent across viewports and semantic zooms", () => {
  const sizes = [
    { width: 1100, height: 650 },
    { width: 390, height: 420 },
    { width: 760, height: 360 },
  ];
  const zooms = [MIN_ZOOM, 1.17, 1.18, 1.89, 1.9, 3.4];

  for (const size of sizes) {
    for (const zoom of zooms) {
      for (const point of [{ x: -10000, y: -10000 }, { x: 1200, y: 750 }, { x: 10000, y: 10000 }]) {
        const bounded = constrainCenter(point, zoom, size, ATLAS_WORLD);
        const boundedAgain = constrainCenter(bounded, zoom, size, ATLAS_WORLD);
        assert.ok(Number.isFinite(bounded.x) && Number.isFinite(bounded.y));
        assert.deepEqual(boundedAgain, bounded);
      }
    }
  }
});

test("portrait cameras can center the lowest architecture components", () => {
  const phone = { width: 390, height: 420 };
  const bottomComponent = { x: 2092.5, y: 1309 };
  const requiredZoom = zoomRequiredToCenter(bottomComponent, phone, ATLAS_WORLD);

  assert.ok(maximumZoom(phone, ATLAS_WORLD) >= requiredZoom);
  const centered = constrainCenter(bottomComponent, requiredZoom, phone, ATLAS_WORLD);
  assert.ok(Math.abs(centered.x - bottomComponent.x) < 0.001);
  assert.ok(Math.abs(centered.y - bottomComponent.y) < 0.001);
});

test("resize re-clamping moves an invalid bottom camera back into portrait bounds", () => {
  const desktop = { width: 1100, height: 650 };
  const portrait = { width: 390, height: 420 };
  const zoom = 2.05;
  const desktopBottom = constrainCenter({ x: 1200, y: 10000 }, zoom, desktop, ATLAS_WORLD);
  const portraitBottom = constrainCenter(desktopBottom, zoom, portrait, ATLAS_WORLD);

  assert.ok(portraitBottom.y < desktopBottom.y);
  assert.deepEqual(
    constrainCenter(portraitBottom, zoom, portrait, ATLAS_WORLD),
    portraitBottom,
  );
});

test("incremental panning reverses immediately after hitting the bottom boundary", () => {
  const size = { width: 1100, height: 650 };
  const zoom = 3.4;
  const bottom = constrainCenter({ x: 1200, y: 10000 }, zoom, size, ATLAS_WORLD);
  const overshot = panCamera({ center: bottom, zoom }, { x: 0, y: -10000 }, size, ATLAS_WORLD);
  const reversed = panCamera(overshot, { x: 0, y: 1 }, size, ATLAS_WORLD);

  assert.equal(overshot.center.y, bottom.y);
  assert.ok(reversed.center.y < bottom.y);
});

test("camera view remains finite at adaptive portrait maximum", () => {
  const phone = { width: 390, height: 420 };
  const maxZoom = maximumZoom(phone, ATLAS_WORLD);
  const view = viewFor({ x: 1200, y: 750 }, maxZoom, phone, ATLAS_WORLD);
  assert.ok(maxZoom > 3.4);
  assert.ok([view.x, view.y, view.width, view.height].every(Number.isFinite));
});

test("interaction contracts prevent scroll traps and stale gesture state", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../app/AuroraAtlas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /addEventListener\("wheel", handleWheel, \{ passive: false \}\)/);
  assert.doesNotMatch(component, /\bonWheel=/);
  assert.match(component, /onLostPointerCapture=\{handleLostPointerCapture\}/);
  assert.match(component, /onClickCapture=\{handleMapClickCapture\}/);
  assert.match(component, /detailScrollRef\.current\?\.scrollTo\(\{ top: 0/);
  assert.match(css, /\.atlas-shell\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.atlas-shell\s*\{[^}]*height:\s*auto;/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.map-stage\s*\{[^}]*touch-action:\s*pan-y;/);
});
