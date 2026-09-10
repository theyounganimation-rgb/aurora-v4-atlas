"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MIN_ZOOM,
  constrainCenter as constrainCameraCenter,
  maximumZoom,
  panCamera,
  viewFor,
  zoomRequiredToCenter,
} from "./atlas-camera.mjs";
import {
  WORLD,
  edgeLabels,
  edges,
  groupEdges,
  groups,
  nodes,
  statusLabels,
  type AtlasEdge,
  type AtlasGroup,
  type AtlasNode,
} from "./atlas-data";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Selection = { kind: "group" | "node"; id: string } | null;

const INITIAL_CENTER = { x: WORLD.width / 2, y: WORLD.height / 2 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const centerOf = (item: Pick<AtlasGroup | AtlasNode, "x" | "y" | "width" | "height">): Point => ({
  x: item.x + item.width / 2,
  y: item.y + item.height / 2,
});

function semanticLevel(zoom: number) {
  if (zoom < 1.18) return 0;
  if (zoom < 1.9) return 1;
  return 2;
}

function semanticLabel(level: number) {
  if (level === 0) return "Whole system";
  if (level === 1) return "Core systems";
  return "Component detail";
}

function anchor(
  item: Pick<AtlasGroup | AtlasNode, "x" | "y" | "width" | "height">,
  target: Point,
) {
  const center = centerOf(item);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const horizontalWeight = Math.abs(dx) / Math.max(item.width, 1);
  const verticalWeight = Math.abs(dy) / Math.max(item.height, 1);

  if (horizontalWeight >= verticalWeight) {
    return {
      x: center.x + Math.sign(dx || 1) * item.width / 2,
      y: center.y + clamp(dy * 0.12, -item.height * 0.28, item.height * 0.28),
    };
  }

  return {
    x: center.x + clamp(dx * 0.12, -item.width * 0.28, item.width * 0.28),
    y: center.y + Math.sign(dy || 1) * item.height / 2,
  };
}

function pathBetween(
  from: Pick<AtlasGroup | AtlasNode, "x" | "y" | "width" | "height">,
  to: Pick<AtlasGroup | AtlasNode, "x" | "y" | "width" | "height">,
) {
  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
  const start = anchor(from, toCenter);
  const end = anchor(to, fromCenter);
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return `M ${start.x} ${start.y} C ${start.x + dx * 0.42} ${start.y}, ${end.x - dx * 0.42} ${end.y}, ${end.x} ${end.y}`;
  }

  return `M ${start.x} ${start.y} C ${start.x} ${start.y + dy * 0.42}, ${end.x} ${end.y - dy * 0.42}, ${end.x} ${end.y}`;
}

function OverviewPanel({ onStart }: { onStart: () => void }) {
  return (
    <div className="detail-content detail-overview">
      <p className="detail-kicker">How to read the atlas</p>
      <h2>Aurora is one system with several kinds of truth.</h2>
      <p className="detail-lede">
        Start with the large regions. Zoom in to reveal the native components, then zoom farther for the
        evidence boundaries and implementation details that keep them honest.
      </p>

      <div className="truth-callout">
        <span className="truth-callout-label">The voice path</span>
        <p>
          Cade speaks → native audio captures waveform → AuroraRealtimeClient transports it → OpenAI
          Realtime reasons and generates audio → native audio plays it.
        </p>
      </div>

      <div className="detail-section">
        <h3>Three distinctions to keep in your head</h3>
        <ul className="plain-list">
          <li><strong>AuroraAppModel</strong> conducts the system; it is not the voice model.</li>
          <li><strong>Realtime</strong> is the foreground conversational mind; Codex performs delegated work.</li>
          <li><strong>OpenClaw</strong> is a side bridge for selected continuity and contact—not the voice path.</li>
        </ul>
      </div>

      <button className="primary-action" type="button" onClick={onStart}>
        Start with the conductor
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

function GroupPanel({
  group,
  groupNodes,
  onChooseNode,
  onZoomIn,
}: {
  group: AtlasGroup;
  groupNodes: AtlasNode[];
  onChooseNode: (node: AtlasNode) => void;
  onZoomIn: () => void;
}) {
  return (
    <div className="detail-content">
      <p className="detail-kicker">{group.eyebrow}</p>
      <h2>{group.label}</h2>
      <p className="detail-lede">{group.summary}</p>

      <div className="detail-section">
        <h3>Why it exists</h3>
        <p>{group.purpose}</p>
      </div>

      <div className="detail-section">
        <div className="section-heading-row">
          <h3>Components</h3>
          <span>{groupNodes.length}</span>
        </div>
        <div className="component-list">
          {groupNodes.map((node) => (
            <button key={node.id} type="button" onClick={() => onChooseNode(node)}>
              <span>{node.shortLabel ?? node.label}</span>
              <small>{node.summary}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="study-question">
        <span>Study question</span>
        <p>{group.studyPrompt}</p>
      </div>

      <button className="secondary-action" type="button" onClick={onZoomIn}>
        Reveal component detail
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

function NodePanel({
  node,
  connections,
  onChooseNode,
}: {
  node: AtlasNode;
  connections: Array<{ edge: AtlasEdge; neighbor: AtlasNode }>;
  onChooseNode: (node: AtlasNode) => void;
}) {
  return (
    <div className="detail-content">
      <div className="node-panel-meta">
        <p className="detail-kicker">{groups.find((group) => group.id === node.group)?.label}</p>
        <span className={`status-pill status-${node.status}`}>{statusLabels[node.status]}</span>
      </div>
      <h2>{node.label}</h2>
      <p className="detail-lede">{node.summary}</p>

      <div className="detail-section">
        <h3>What it does</h3>
        <p>{node.purpose}</p>
      </div>

      <div className="io-grid">
        <div className="detail-section compact-section">
          <h3>Receives</h3>
          <ul className="plain-list">
            {node.receives.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div className="detail-section compact-section">
          <h3>Sends</h3>
          <ul className="plain-list">
            {node.sends.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>

      <div className="boundary-card">
        <span>Truth / authority boundary</span>
        {node.boundaries.map((boundary) => <p key={boundary}>{boundary}</p>)}
      </div>

      {connections.length > 0 && (
        <div className="detail-section">
          <div className="section-heading-row">
            <h3>Connected to</h3>
            <span>{connections.length}</span>
          </div>
          <div className="connection-list">
            {connections.map(({ edge, neighbor }) => {
              const outgoing = edge.from === node.id;
              return (
                <button key={edge.id} type="button" onClick={() => onChooseNode(neighbor)}>
                  <span className={`connection-arrow edge-${edge.kind}`} aria-hidden="true">
                    {edge.twoWay ? "↔" : outgoing ? "→" : "←"}
                  </span>
                  <span>
                    <strong>{neighbor.shortLabel ?? neighbor.label}</strong>
                    <small>{edge.label}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="detail-section">
        <h3>Key source</h3>
        <div className="file-list">
          {node.files.map((file) => <code key={file}>{file}</code>)}
        </div>
      </div>

      <div className="study-question">
        <span>Check your understanding</span>
        <p>{node.studyPrompt}</p>
      </div>
    </div>
  );
}

export function AuroraAtlas() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{
    lastDistance: number;
    lastMidpoint: Point;
  } | null>(null);
  const cameraRef = useRef({ center: INITIAL_CENTER, zoom: 1 });
  const gestureDistanceRef = useRef(0);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);
  const [size, setSize] = useState<Size>({ width: 1000, height: 760 });
  const [center, setCenter] = useState<Point>(INITIAL_CENTER);
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<Selection>(null);
  const [dragging, setDragging] = useState(false);

  const clearGestureState = useCallback(() => {
    pointersRef.current.clear();
    dragRef.current = null;
    pinchRef.current = null;
    gestureDistanceRef.current = 0;
    setDragging(false);
  }, []);

  useEffect(() => {
    const element = mapContainerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cancelInterruptedGesture = () => clearGestureState();
    const cancelHiddenGesture = () => {
      if (document.visibilityState === "hidden") clearGestureState();
    };
    window.addEventListener("blur", cancelInterruptedGesture);
    document.addEventListener("visibilitychange", cancelHiddenGesture);
    return () => {
      window.removeEventListener("blur", cancelInterruptedGesture);
      document.removeEventListener("visibilitychange", cancelHiddenGesture);
      if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current);
    };
  }, [clearGestureState]);

  const level = semanticLevel(zoom);
  const viewBox = useMemo(() => viewFor(center, zoom, size, WORLD), [center, size, zoom]);
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), []);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), []);

  const constrainCenter = useCallback((point: Point, atZoom: number) => {
    return constrainCameraCenter(point, atZoom, size, WORLD);
  }, [size]);

  const commitCamera = useCallback((point: Point, nextZoom: number) => {
    const boundedZoom = clamp(nextZoom, MIN_ZOOM, maximumZoom(size, WORLD));
    const boundedCenter = constrainCenter(point, boundedZoom);
    cameraRef.current = { center: boundedCenter, zoom: boundedZoom };
    setZoom(boundedZoom);
    setCenter(boundedCenter);
  }, [constrainCenter, size]);

  useEffect(() => {
    const currentCamera = cameraRef.current;
    const boundedCenter = constrainCenter(currentCamera.center, currentCamera.zoom);
    if (boundedCenter.x === currentCamera.center.x && boundedCenter.y === currentCamera.center.y) return;
    cameraRef.current = { ...currentCamera, center: boundedCenter };
    setCenter(boundedCenter);
  }, [constrainCenter, size]);

  useEffect(() => {
    if (!selection) return;
    const frame = window.requestAnimationFrame(() => {
      detailScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
      if (window.matchMedia("(max-width: 820px)").matches) {
        detailPanelRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selection]);

  const applyZoom = useCallback((nextZoom: number, focus?: Point) => {
    commitCamera(focus ?? cameraRef.current.center, nextZoom);
  }, [commitCamera]);

  const resetMap = useCallback(() => {
    commitCamera(INITIAL_CENTER, 1);
    setSelection(null);
  }, [commitCamera]);

  const resetAndShowMap = useCallback(() => {
    resetMap();
    if (window.matchMedia("(max-width: 820px)").matches) {
      window.requestAnimationFrame(() => mapContainerRef.current?.scrollIntoView({ block: "start", behavior: "auto" }));
    }
  }, [resetMap]);

  const focusGroup = useCallback((group: AtlasGroup, revealDetails = false) => {
    const currentZoom = cameraRef.current.zoom;
    const desiredZoom = revealDetails ? Math.max(2.05, currentZoom) : currentZoom < 1.18 ? 1.5 : Math.max(currentZoom, 1.5);
    const target = centerOf(group);
    const nextZoom = Math.max(desiredZoom, zoomRequiredToCenter(target, size, WORLD));
    setSelection({ kind: "group", id: group.id });
    applyZoom(nextZoom, target);
  }, [applyZoom, size]);

  const focusNode = useCallback((node: AtlasNode) => {
    const target = centerOf(node);
    const nextZoom = Math.max(2.05, cameraRef.current.zoom, zoomRequiredToCenter(target, size, WORLD));
    setSelection({ kind: "node", id: node.id });
    applyZoom(nextZoom, target);
  }, [applyZoom, size]);

  const zoomAroundClientPoint = useCallback((clientX: number, clientY: number, nextZoom: number) => {
    const element = mapContainerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const normalizedX = (clientX - rect.left) / Math.max(rect.width, 1);
    const normalizedY = (clientY - rect.top) / Math.max(rect.height, 1);
    const currentCamera = cameraRef.current;
    const currentView = viewFor(currentCamera.center, currentCamera.zoom, size, WORLD);
    const worldPoint = {
      x: currentView.x + normalizedX * currentView.width,
      y: currentView.y + normalizedY * currentView.height,
    };
    const boundedZoom = clamp(nextZoom, MIN_ZOOM, maximumZoom(size, WORLD));
    const nextView = viewFor(currentCamera.center, boundedZoom, size, WORLD);
    const nextCenter = {
      x: worldPoint.x - (normalizedX - 0.5) * nextView.width,
      y: worldPoint.y - (normalizedY - 0.5) * nextView.height,
    };
    commitCamera(nextCenter, boundedZoom);
  }, [commitCamera, size]);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0012);
    zoomAroundClientPoint(event.clientX, event.clientY, cameraRef.current.zoom * factor);
  }, [zoomAroundClientPoint]);

  useEffect(() => {
    const element = mapContainerRef.current;
    if (!element) return;
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (pointersRef.current.size >= 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size === 0) {
      gestureDistanceRef.current = 0;
      suppressClickRef.current = false;
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1) {
      dragRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
    } else if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      pinchRef.current = {
        lastDistance: Math.hypot(second.x - first.x, second.y - first.y),
        lastMidpoint: midpoint,
      };
      dragRef.current = null;
    }
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const previousPointer = pointersRef.current.get(event.pointerId)!;
    gestureDistanceRef.current += Math.hypot(
      event.clientX - previousPointer.x,
      event.clientY - previousPointer.y,
    );
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const element = mapContainerRef.current;
      if (!element) return;
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const rect = element.getBoundingClientRect();
      const previousX = (pinchRef.current.lastMidpoint.x - rect.left) / Math.max(rect.width, 1);
      const previousY = (pinchRef.current.lastMidpoint.y - rect.top) / Math.max(rect.height, 1);
      const normalizedX = (midpoint.x - rect.left) / Math.max(rect.width, 1);
      const normalizedY = (midpoint.y - rect.top) / Math.max(rect.height, 1);
      const currentCamera = cameraRef.current;
      const currentView = viewFor(currentCamera.center, currentCamera.zoom, size, WORLD);
      const anchoredWorldPoint = {
        x: currentView.x + previousX * currentView.width,
        y: currentView.y + previousY * currentView.height,
      };
      const nextZoom = clamp(
        currentCamera.zoom * distance / Math.max(pinchRef.current.lastDistance, 1),
        MIN_ZOOM,
        maximumZoom(size, WORLD),
      );
      const nextView = viewFor(currentCamera.center, nextZoom, size, WORLD);
      const nextCenter = {
        x: anchoredWorldPoint.x - (normalizedX - 0.5) * nextView.width,
        y: anchoredWorldPoint.y - (normalizedY - 0.5) * nextView.height,
      };
      pinchRef.current = { lastDistance: distance, lastMidpoint: midpoint };
      commitCamera(nextCenter, nextZoom);
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const element = mapContainerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const liveSize = { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
    const nextCamera = panCamera(
      cameraRef.current,
      { x: event.clientX - drag.lastX, y: event.clientY - drag.lastY },
      liveSize,
      WORLD,
    );
    dragRef.current = { pointerId: drag.pointerId, lastX: event.clientX, lastY: event.clientY };
    commitCamera(nextCamera.center, nextCamera.zoom);
  }, [commitCamera, size]);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pinchRef.current = null;

    const remaining = [...pointersRef.current.entries()][0];
    if (remaining) {
      dragRef.current = {
        pointerId: remaining[0],
        lastX: remaining[1].x,
        lastY: remaining[1].y,
      };
    } else {
      dragRef.current = null;
      setDragging(false);
      if (gestureDistanceRef.current > 6) {
        suppressClickRef.current = true;
        if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = window.setTimeout(() => {
          suppressClickRef.current = false;
          suppressClickTimerRef.current = null;
        }, 0);
      }
      gestureDistanceRef.current = 0;
    }
  }, []);

  const handleLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    clearGestureState();
  }, [clearGestureState]);

  const handleMapClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }, []);

  const visibleNodes = useMemo(
    () => level === 0 ? [] : nodes.filter((node) => node.lod <= level),
    [level],
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((edge) => edge.lod <= level && visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)),
    [level, visibleNodeIds],
  );

  const selectedNode = selection?.kind === "node" ? nodeById.get(selection.id) ?? null : null;
  const selectedGroup = selection?.kind === "group" ? groupById.get(selection.id) ?? null : null;
  const selectedGroupNodes = selectedGroup ? nodes.filter((node) => node.group === selectedGroup.id) : [];
  const selectedConnections = useMemo(
    () => selectedNode
      ? edges.flatMap((edge) => {
          if (edge.from !== selectedNode.id && edge.to !== selectedNode.id) return [];
          const neighborId = edge.from === selectedNode.id ? edge.to : edge.from;
          const neighbor = nodeById.get(neighborId);
          return neighbor ? [{ edge, neighbor }] : [];
        })
      : [],
    [nodeById, selectedNode],
  );
  const connectedIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    return new Set(selectedConnections.map(({ neighbor }) => neighbor.id));
  }, [selectedConnections, selectedNode]);

  return (
    <main className="atlas-shell">
      <header className="site-header">
        <div className="brand-lockup">
          <div className="aurora-mark" aria-hidden="true"><span /></div>
          <div>
            <p>Aurora V4</p>
            <h1>Architecture Atlas</h1>
          </div>
        </div>
        <div className="header-copy">
          <p>Explore how Aurora hears, remembers, reflects, acts, and proves what happened.</p>
          <span>Source-backed study map · 8 systems · {nodes.length} components</span>
        </div>
      </header>
      <p className="sr-only" aria-live="polite">
        {selectedNode ? `Selected ${selectedNode.label}` : selectedGroup ? `Selected ${selectedGroup.label}` : `Showing the whole Aurora V4 system`}
      </p>

      <section className="atlas-workspace" aria-label="Aurora V4 architecture explorer">
        <div className="map-column">
          <div className="map-toolbar">
            <div className="semantic-readout" aria-live="polite">
              <span className={`level-dot level-${level}`} aria-hidden="true" />
              <div>
                <small>Semantic zoom</small>
                <strong>{semanticLabel(level)}</strong>
              </div>
            </div>
            <div className="map-controls" aria-label="Map controls">
              <button type="button" onClick={() => applyZoom(zoom / 1.28)} aria-label="Zoom out">−</button>
              <span aria-hidden="true">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => applyZoom(zoom * 1.28)} aria-label="Zoom in">+</button>
              <button className="reset-control" type="button" onClick={resetMap}>Reset</button>
            </div>
          </div>

          <div
            ref={mapContainerRef}
            className={`map-stage${dragging ? " is-dragging" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={handleLostPointerCapture}
            onClickCapture={handleMapClickCapture}
          >
            <svg
              className="atlas-map"
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              role="img"
              aria-labelledby="map-title map-description"
            >
              <title id="map-title">Interactive map of Aurora V4</title>
              <desc id="map-description">
                Pan and zoom through eight architecture regions. Select any visible region or component to study its role and connections.
              </desc>
              <defs>
                <pattern id="atlas-grid" width="44" height="44" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="1.15" />
                </pattern>
                {(["voice", "context", "action", "evidence", "bridge"] as const).map((kind) => (
                  <marker key={kind} id={`arrow-${kind}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" className={`marker-${kind}`} />
                  </marker>
                ))}
                <filter id="selected-glow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="12" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              <g className="grid-layer" aria-hidden="true">
                <path d={`M 0 0 H ${WORLD.width} V ${WORLD.height} H 0 Z`} />
              </g>

              {level === 0 && (
                <g className="edge-layer macro-edge-layer" aria-hidden="true">
                  {groupEdges.map((edge) => {
                    const from = groupById.get(edge.from);
                    const to = groupById.get(edge.to);
                    if (!from || !to) return null;
                    return (
                      <path
                        key={edge.id}
                        className={`map-edge edge-${edge.kind}`}
                        d={pathBetween(from, to)}
                        markerEnd={`url(#arrow-${edge.kind})`}
                        markerStart={edge.twoWay ? `url(#arrow-${edge.kind})` : undefined}
                      />
                    );
                  })}
                </g>
              )}

              <g className="group-layer">
                {groups.map((group) => {
                  const isSelected = selectedGroup?.id === group.id || selectedNode?.group === group.id;
                  return (
                    <g key={group.id} className={`map-group${isSelected ? " is-selected" : ""}`}>
                      <rect className="group-field" x={group.x} y={group.y} width={group.width} height={group.height} rx="28" style={{ color: group.color }} />
                      <foreignObject
                        x={group.x + 18}
                        y={group.y + 18}
                        width={level === 0 ? group.width - 36 : Math.min(group.width - 36, 270)}
                        height={level === 0 ? Math.min(group.height - 36, 175) : 72}
                      >
                        <button
                          type="button"
                          className={`group-focus-button level-${level}`}
                          style={{ "--group-color": group.color } as CSSProperties}
                          onClick={() => focusGroup(group)}
                          aria-label={`Study ${group.label}`}
                        >
                          <small>{group.eyebrow}</small>
                          <strong>{group.label}</strong>
                          {level === 0 && <span>{group.summary}</span>}
                        </button>
                      </foreignObject>
                    </g>
                  );
                })}
              </g>

              {level > 0 && (
                <g className="edge-layer" aria-hidden="true">
                  {visibleEdges.map((edge) => {
                    const from = nodeById.get(edge.from);
                    const to = nodeById.get(edge.to);
                    if (!from || !to) return null;
                    const active = selectedNode && (edge.from === selectedNode.id || edge.to === selectedNode.id);
                    const dimmed = selectedNode && !active;
                    return (
                      <g key={edge.id} className={`edge-wrap${active ? " is-active" : ""}${dimmed ? " is-dimmed" : ""}`}>
                        <path
                          className={`map-edge edge-${edge.kind}`}
                          d={pathBetween(from, to)}
                          markerEnd={`url(#arrow-${edge.kind})`}
                          markerStart={edge.twoWay ? `url(#arrow-${edge.kind})` : undefined}
                        />
                        {level === 2 && active && (
                          <text className="edge-caption" x={(centerOf(from).x + centerOf(to).x) / 2} y={(centerOf(from).y + centerOf(to).y) / 2 - 8}>
                            {edge.label}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              )}

              {level > 0 && (
                <g className="node-layer">
                  {visibleNodes.map((node) => {
                    const group = groupById.get(node.group);
                    const selected = selectedNode?.id === node.id;
                    const connected = connectedIds.has(node.id);
                    const dimmed = Boolean(selectedNode && !selected && !connected);
                    return (
                      <foreignObject key={node.id} x={node.x} y={node.y} width={node.width} height={node.height}>
                        <button
                          type="button"
                          className={`map-node-button status-${node.status}${selected ? " is-selected" : ""}${connected ? " is-connected" : ""}${dimmed ? " is-dimmed" : ""}`}
                          style={{ "--group-color": group?.color ?? "#bfa27a" } as CSSProperties}
                          onClick={() => focusNode(node)}
                          aria-label={`Study ${node.label}: ${node.summary}`}
                        >
                          <span className="node-status-dot" aria-hidden="true" />
                          <strong>{node.shortLabel ?? node.label}</strong>
                          {level === 2 && <small>{node.label}</small>}
                        </button>
                      </foreignObject>
                    );
                  })}
                </g>
              )}
            </svg>

            <div className="map-hint" aria-hidden="true">
              <span>Drag to move</span><i /> <span>Scroll or pinch to explore</span><i /> <span>Click to study</span>
            </div>
            <div className="edge-legend" aria-label="Connection legend">
              {(Object.keys(edgeLabels) as Array<keyof typeof edgeLabels>).map((kind) => (
                <span key={kind}><i className={`legend-${kind}`} />{edgeLabels[kind]}</span>
              ))}
            </div>
          </div>
        </div>

        <aside ref={detailPanelRef} className="detail-panel" aria-label="Selected architecture detail">
          <div ref={detailScrollRef} className="detail-panel-scroll">
            {!selection && <OverviewPanel onStart={() => focusGroup(groupById.get("orchestration")!)} />}
            {selectedGroup && (
              <GroupPanel
                group={selectedGroup}
                groupNodes={selectedGroupNodes}
                onChooseNode={focusNode}
                onZoomIn={() => focusGroup(selectedGroup, true)}
              />
            )}
            {selectedNode && (
              <NodePanel node={selectedNode} connections={selectedConnections} onChooseNode={focusNode} />
            )}
          </div>
          <div className="detail-footer">
            <span>Verified architecture study aid</span>
            <button type="button" onClick={resetAndShowMap}>Whole-system view</button>
          </div>
        </aside>
      </section>
    </main>
  );
}
