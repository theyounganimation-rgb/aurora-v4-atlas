export const ATLAS_WORLD = Object.freeze({ width: 2400, height: 1500 });
export const MIN_ZOOM = 0.92;
export const DESKTOP_MAX_ZOOM = 3.4;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** @param {{width: number, height: number}} size */
export function baseView(size, world = ATLAS_WORLD) {
  const viewportAspect = size.width / Math.max(size.height, 1);
  const worldAspect = world.width / world.height;

  if (viewportAspect > worldAspect) {
    return { width: world.height * viewportAspect, height: world.height };
  }

  return { width: world.width, height: world.width / viewportAspect };
}

/**
 * @param {{x: number, y: number}} center
 * @param {number} zoom
 * @param {{width: number, height: number}} size
 */
export function viewFor(center, zoom, size, world = ATLAS_WORLD) {
  const base = baseView(size, world);
  const width = base.width / zoom;
  const height = base.height / zoom;
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  };
}

/** @param {{width: number, height: number}} size */
export function maximumZoom(size, world = ATLAS_WORLD) {
  const base = baseView(size, world);
  const portraitAllowance = 1.35 * base.width / Math.max(size.width, 1);
  return Math.min(8.5, Math.max(DESKTOP_MAX_ZOOM, portraitAllowance));
}

/**
 * @param {{x: number, y: number}} point
 * @param {{width: number, height: number}} size
 */
export function zoomRequiredToCenter(point, size, world = ATLAS_WORLD, padding = 100) {
  const base = baseView(size, world);
  const availableWidth = 2 * Math.min(point.x + padding, world.width - point.x + padding);
  const availableHeight = 2 * Math.min(point.y + padding, world.height - point.y + padding);
  return Math.max(
    MIN_ZOOM,
    base.width / Math.max(availableWidth, 1),
    base.height / Math.max(availableHeight, 1),
  );
}

/**
 * @param {{x: number, y: number}} point
 * @param {number} zoom
 * @param {{width: number, height: number}} size
 */
export function constrainCenter(point, zoom, size, world = ATLAS_WORLD, padding = 100) {
  const view = viewFor(point, zoom, size, world);
  const minX = view.width >= world.width + padding * 2 ? world.width / 2 : view.width / 2 - padding;
  const maxX = view.width >= world.width + padding * 2 ? world.width / 2 : world.width - view.width / 2 + padding;
  const minY = view.height >= world.height + padding * 2 ? world.height / 2 : view.height / 2 - padding;
  const maxY = view.height >= world.height + padding * 2 ? world.height / 2 : world.height - view.height / 2 + padding;
  return {
    x: clamp(point.x, Math.min(minX, maxX), Math.max(minX, maxX)),
    y: clamp(point.y, Math.min(minY, maxY), Math.max(minY, maxY)),
  };
}

/**
 * Applies one screen-space movement increment. Because each event starts from
 * the last committed camera, reversing at a boundary responds immediately.
 * @param {{center: {x: number, y: number}, zoom: number}} camera
 * @param {{x: number, y: number}} screenDelta
 * @param {{width: number, height: number}} size
 */
export function panCamera(camera, screenDelta, size, world = ATLAS_WORLD) {
  const view = viewFor(camera.center, camera.zoom, size, world);
  const target = {
    x: camera.center.x - screenDelta.x / Math.max(size.width, 1) * view.width,
    y: camera.center.y - screenDelta.y / Math.max(size.height, 1) * view.height,
  };
  return {
    center: constrainCenter(target, camera.zoom, size, world),
    zoom: camera.zoom,
  };
}
