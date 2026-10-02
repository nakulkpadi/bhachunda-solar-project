const viewTitles = {
  dashboard: "Land acquisition overview",
  parcels: "Parcel registry",
  entry: "Land acquisition record",
  documents: "Document centre",
  reports: "Report centre",
  map: "Interactive project map"
};

const buttons = document.querySelectorAll("[data-view-target]");
const views = document.querySelectorAll("[data-view]");
const pageTitle = document.querySelector("#page-title");

function showView(viewName) {
  views.forEach((view) => {
    const active = view.dataset.view === viewName;
    view.hidden = !active;
    view.classList.toggle("is-active", active);
  });

  buttons.forEach((button) => {
    const active = button.dataset.viewTarget === viewName;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  pageTitle.textContent = viewTitles[viewName] ?? viewTitles.dashboard;
  window.location.hash = viewName;
}

buttons.forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.viewTarget));
});

const hashView = window.location.hash.replace("#", "");
if (viewTitles[hashView]) showView(hashView);

const mapHost = document.querySelector("#cad-map");
const mapBadge = document.querySelector("#map-source-badge");
const inspectorTitle = document.querySelector("[data-map-inspector-title]");
const inspectorDescription = document.querySelector("[data-map-inspector-description]");
const inspectorMeta = document.querySelector("[data-map-inspector-meta]");

function parseViewBox(svg) {
  const values = (svg.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
  if (values.length !== 4 || values.some(Number.isNaN)) throw new Error("Invalid CAD SVG viewBox");
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

function constrain(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function describeFeature(feature) {
  const survey = feature.dataset.cadSurvey || "Unknown";
  const displayStatus = feature.dataset.displayConsent;
  const bindingState = feature.dataset.workbookBinding;
  const linkedRecordCount = Number(feature.dataset.linkedRecordCount || 0);

  inspectorTitle.textContent = `Survey ${survey}`;
  if (displayStatus === "received") {
    inspectorDescription.textContent = "Green: the linked Bhavanipar source record(s) currently show consent received.";
  } else if (bindingState === "bhavanipar_candidate") {
    inspectorDescription.textContent = "Bhavanipar source candidate found, but its consent is not recorded as received. It stays neutral.";
  } else if (bindingState === "cross_village_candidate") {
    inspectorDescription.textContent = "A similarly numbered record exists in another village. Keep this CAD shape neutral until its village boundary is approved.";
  } else {
    inspectorDescription.textContent = "No current workbook candidate is attached to this CAD shape. It stays neutral until map validation is completed.";
  }
  inspectorMeta.textContent = linkedRecordCount
    ? `${linkedRecordCount} Bhavanipar source record${linkedRecordCount === 1 ? "" : "s"} linked for preview.`
    : "No consent status is being inferred for this preview.";
}

function activateCadMap(svg) {
  const base = parseViewBox(svg);
  const state = { zoom: 1, centerX: base.x + base.width / 2, centerY: base.y + base.height / 2, drag: null };

  function applyViewBox() {
    const width = base.width / state.zoom;
    const height = base.height / state.zoom;
    state.centerX = constrain(state.centerX, base.x + width / 2, base.x + base.width - width / 2);
    state.centerY = constrain(state.centerY, base.y + height / 2, base.y + base.height - height / 2);
    svg.setAttribute("viewBox", `${state.centerX - width / 2} ${state.centerY - height / 2} ${width} ${height}`);
  }

  function changeZoom(amount) {
    state.zoom = constrain(state.zoom + amount, 1, 14);
    applyViewBox();
  }

  document.querySelectorAll("[data-map-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.mapAction;
      if (action === "zoom-in") changeZoom(0.75);
      if (action === "zoom-out") changeZoom(-0.75);
      if (action === "reset") {
        state.zoom = 1;
        state.centerX = base.x + base.width / 2;
        state.centerY = base.y + base.height / 2;
        applyViewBox();
      }
    });
  });

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 0.5 : -0.5);
  }, { passive: false });

  svg.addEventListener("pointerdown", (event) => {
    state.drag = { x: event.clientX, y: event.clientY, centerX: state.centerX, centerY: state.centerY };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!state.drag) return;
    const bounds = svg.getBoundingClientRect();
    state.centerX = state.drag.centerX - (event.clientX - state.drag.x) * (base.width / bounds.width) / state.zoom;
    state.centerY = state.drag.centerY - (event.clientY - state.drag.y) * (base.height / bounds.height) / state.zoom;
    applyViewBox();
  });
  svg.addEventListener("pointerup", () => { state.drag = null; });
  svg.addEventListener("pointercancel", () => { state.drag = null; });
  svg.addEventListener("click", (event) => {
    const feature = event.target.closest(".parcel-feature");
    if (feature) describeFeature(feature);
  });
  svg.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches(".parcel-feature")) {
      event.preventDefault();
      describeFeature(event.target);
    }
  });
}

async function loadCadMap() {
  if (!mapHost) return;
  try {
    const response = await fetch("assets/combined-villages-interactive.svg");
    if (!response.ok) throw new Error(`SVG request failed (${response.status})`);
    const markup = await response.text();
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("The CAD SVG could not be parsed");
    const svg = document.importNode(parsed.documentElement, true);
    svg.classList.add("cad-svg");
    mapHost.replaceChildren(svg);
    mapHost.setAttribute("aria-busy", "false");
    mapBadge.textContent = "CAD SVG ready";
    activateCadMap(svg);
  } catch (error) {
    mapHost.setAttribute("aria-busy", "false");
    mapHost.innerHTML = "<p class=\"map-loading\">The CAD SVG is available in the project assets, but this preview needs a web server to load it.</p>";
    mapBadge.textContent = "CAD SVG available";
    console.error(error);
  }
}

void loadCadMap();
