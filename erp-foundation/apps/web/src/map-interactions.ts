export type MapBox = [number, number, number, number];
const parse = (value: string | undefined | null): MapBox | null => {
  const parts = (value || "").trim().split(/[\s,]+/).map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0 ? parts as MapBox : null;
};
export function clampMapBox(box: MapBox, boundary: MapBox): MapBox {
  const width = Math.min(boundary[2], Math.max(boundary[2] / 40, box[2]));
  const height = width * boundary[3] / boundary[2];
  return [Math.min(boundary[0] + boundary[2] - width, Math.max(boundary[0], box[0])), Math.min(boundary[1] + boundary[3] - height, Math.max(boundary[1], box[1])), width, height];
}
export function zoomBox(current: MapBox, boundary: MapBox, factor: number, point?: { x: number; y: number }): MapBox {
  const anchor = point || { x: current[0] + current[2] / 2, y: current[1] + current[3] / 2 };
  const ratio = Math.max(.1, Math.min(10, factor));
  const width = Math.min(boundary[2], Math.max(boundary[2] / 40, current[2] * ratio));
  const scale = width / current[2];
  return clampMapBox([anchor.x - (anchor.x - current[0]) * scale, anchor.y - (anchor.y - current[1]) * scale, width, current[3] * scale], boundary);
}
export function zoomMapView(root: SVGSVGElement, factor: number, point?: { x: number; y: number }): void {
  const boundary = parse(root.dataset.fitViewBox || root.dataset.cadViewBox || root.getAttribute("viewBox"));
  const current = parse(root.getAttribute("viewBox"));
  if (boundary && current) root.setAttribute("viewBox", zoomBox(current, boundary, factor, point).join(" "));
}
export function attachMapNavigation(root: SVGSVGElement): void {
  if (root.dataset.navigationReady) return;
  root.dataset.navigationReady = "true";
  root.style.touchAction = "none";
  root.style.userSelect = "none";
  root.style.cursor = "grab";
  root.setAttribute("tabindex", "0");
  root.setAttribute("aria-label", "Survey map. Scroll to zoom. Drag to move. Use arrow keys to pan.");
  root.addEventListener("wheel", (event) => {
    event.preventDefault();
    const matrix = root.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
    zoomMapView(root, Math.exp(Math.max(-180, Math.min(180, delta)) * .0025), point);
  }, { passive: false });
  let drag: { id: number; x: number; y: number; box: MapBox; inverse: DOMMatrix; moved: boolean } | null = null;
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const box = parse(root.getAttribute("viewBox")), matrix = root.getScreenCTM();
    if (!box || !matrix) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, box, inverse: matrix.inverse(), moved: false };
  });
  root.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4 && !drag.moved) return;
    drag.moved = true; root.style.cursor = "grabbing";
    if (!root.hasPointerCapture(event.pointerId)) root.setPointerCapture(event.pointerId);
    const start = new DOMPoint(drag.x, drag.y).matrixTransform(drag.inverse);
    const end = new DOMPoint(event.clientX, event.clientY).matrixTransform(drag.inverse);
    const boundary = parse(root.dataset.fitViewBox || root.dataset.cadViewBox);
    if (boundary) root.setAttribute("viewBox", clampMapBox([drag.box[0] + start.x - end.x, drag.box[1] + start.y - end.y, drag.box[2], drag.box[3]], boundary).join(" "));
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.moved) root.dataset.ignoreClickUntil = String(Date.now() + 200);
    drag = null; root.style.cursor = "grab";
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
  };
  root.addEventListener("pointerup", endDrag); root.addEventListener("pointercancel", endDrag);
  root.addEventListener("click", event => { if (Number(root.dataset.ignoreClickUntil || 0) > Date.now()) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  root.addEventListener("keydown", event => {
    if (event.target !== root) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomMapView(root, .8); return; }
    if (event.key === "-") { event.preventDefault(); zoomMapView(root, 1.25); return; }
    const boundary = parse(root.dataset.fitViewBox || root.dataset.cadViewBox), current = parse(root.getAttribute("viewBox"));
    if (!boundary || !current) return;
    if (event.key === "Home" || event.key === "0") { event.preventDefault(); root.setAttribute("viewBox", boundary.join(" ")); return; }
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key]) { event.preventDefault(); const [x, y] = directions[event.key]; root.setAttribute("viewBox", clampMapBox([current[0] + x * current[2] * .1, current[1] + y * current[3] * .1, current[2], current[3]], boundary).join(" ")); }
  });
}
