import { estimateQldPayload } from "./qld.js";

const state = {
  grid: [],
  pointerValue: null,
  estimateTimer: null,
  resultsTsv: "",
  summaryTsv: "",
  summaryValuesTsv: "",
};

const elements = {
  dilutionCount: document.getElementById("dilution-count"),
  replicateCount: document.getElementById("replicate-count"),
  foldInput: document.getElementById("fold-input"),
  growthGrid: document.getElementById("growth-grid"),
  status: document.getElementById("estimate-status"),
  selectedSummary: document.getElementById("selected-summary"),
  mle: document.getElementById("mle-display"),
  ci: document.getElementById("ci-display"),
  variance: document.getElementById("variance-display"),
  summaryHeaderRow: document.getElementById("summary-header-row"),
  summaryValueRow: document.getElementById("summary-value-row"),
  likelihoodPlot: document.getElementById("likelihood-plot"),
  curveCaption: document.getElementById("curve-caption"),
  createGrid: document.getElementById("create-grid"),
  copySummary: document.getElementById("copy-summary"),
  copyResults: document.getElementById("copy-results"),
};

function setStatus(message) {
  elements.status.textContent = message;
}

function resetResults(message) {
  setStatus(message);
  elements.selectedSummary.textContent = "None yet.";
  elements.mle.textContent = "N/A";
  elements.ci.textContent = "N/A";
  elements.variance.textContent = "N/A";
  state.resultsTsv = "";
  state.summaryTsv = "";
  state.summaryValuesTsv = "";
  elements.curveCaption.textContent = "Updates with the selected wells";
  elements.likelihoodPlot.className = "likelihood-plot empty-state";
  elements.likelihoodPlot.textContent = "Create a grid to see the fitted upstream QLD objective.";
  renderSummaryTable(["", "", "", "", ""]);
}

function parsePositiveInteger(value, name, minimum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}.`);
  }
  return parsed;
}

function buildGrid(dilutions, replicates) {
  return Array.from({ length: dilutions }, () => Array.from({ length: replicates }, () => false));
}

function getCellCoordinates(node) {
  const cellId = node?.dataset?.cell;
  if (!cellId) {
    return null;
  }

  const [rowText, columnText] = cellId.split(":");
  const rowIndex = Number.parseInt(rowText, 10);
  const columnIndex = Number.parseInt(columnText, 10);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) {
    return null;
  }

  return { rowIndex, columnIndex };
}

function setCellState(rowIndex, columnIndex, value) {
  if (!state.grid[rowIndex] || state.grid[rowIndex][columnIndex] === value) {
    return;
  }

  state.grid[rowIndex][columnIndex] = value;
  const button = elements.growthGrid.querySelector(`[data-cell="${rowIndex}:${columnIndex}"]`);
  if (button) {
    button.textContent = value ? "1" : "0";
    button.classList.toggle("growth-grid__cell--positive", value);
    button.setAttribute("aria-pressed", value ? "true" : "false");
  }
  scheduleEstimate();
}

function paintCellFromHoverTarget(target) {
  if (state.pointerValue === null) {
    return;
  }

  if (!target || !elements.growthGrid.contains(target)) {
    return;
  }

  const coordinates = getCellCoordinates(target);
  if (!coordinates) {
    return;
  }

  setCellState(coordinates.rowIndex, coordinates.columnIndex, state.pointerValue);
}

function clearPointerPaint() {
  state.pointerValue = null;
}

function renderGrid() {
  if (!state.grid.length) {
    elements.growthGrid.className = "growth-grid-shell empty-state";
    elements.growthGrid.textContent = "Build the grid to start entering wells.";
    return;
  }

  const table = document.createElement("table");
  table.className = "growth-grid";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.innerHTML = `
    <th scope="col">Dilution</th>
    ${state.grid[0].map((_, index) => `<th scope="col">Rep ${index + 1}</th>`).join("")}
    <th scope="col">Positive count</th>
  `;
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  state.grid.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    const labelCell = document.createElement("th");
    labelCell.scope = "row";
    labelCell.textContent = `Dilution ${rowIndex + 1}`;
    tr.appendChild(labelCell);

    row.forEach((value, columnIndex) => {
      const td = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `growth-grid__cell${value ? " growth-grid__cell--positive" : ""}`;
      button.dataset.cell = `${rowIndex}:${columnIndex}`;
      button.textContent = value ? "1" : "0";
      button.setAttribute("aria-label", `Dilution ${rowIndex + 1}, replicate ${columnIndex + 1}`);
      button.setAttribute("aria-pressed", value ? "true" : "false");
      button.addEventListener("contextmenu", (event) => event.preventDefault());
      button.addEventListener("mousedown", (event) => {
        const nextValue = event.button === 2 || event.shiftKey ? false : true;
        state.pointerValue = nextValue;
        setCellState(rowIndex, columnIndex, nextValue);
        event.preventDefault();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          setCellState(rowIndex, columnIndex, !state.grid[rowIndex][columnIndex]);
        } else if (event.key === "1") {
          event.preventDefault();
          setCellState(rowIndex, columnIndex, true);
        } else if (event.key === "0" || event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          setCellState(rowIndex, columnIndex, false);
        }
      });
      td.appendChild(button);
      tr.appendChild(td);
    });

    const summaryCell = document.createElement("td");
    summaryCell.innerHTML = `<span class="growth-grid__summary" data-row-summary="${rowIndex}">0 / ${row.length}</span>`;
    tr.appendChild(summaryCell);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  elements.growthGrid.className = "growth-grid-shell";
  elements.growthGrid.innerHTML = "";
  elements.growthGrid.appendChild(table);
}

function renderSummaryTable(values) {
  const headers = ["Dilution factor", "MLE", "CI lower", "CI upper", "Variance"];
  elements.summaryHeaderRow.innerHTML = headers.map((label) => `<th scope="col">${label}</th>`).join("");
  elements.summaryValueRow.innerHTML = headers
    .map((label, index) => `<td><span aria-label="${label}">${values[index] || ""}</span></td>`)
    .join("");
}

function renderCurve(curve) {
  if (!curve || !Array.isArray(curve.points) || !curve.points.length) {
    elements.curveCaption.textContent = "Curve unavailable for this selection";
    elements.likelihoodPlot.className = "likelihood-plot empty-state";
    elements.likelihoodPlot.textContent = "Curve unavailable for this selection.";
    return;
  }

  const width = 720;
  const height = 300;
  const margin = { top: 18, right: 22, bottom: 52, left: 54 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const logMin = Math.log10(curve.x_min);
  const logMax = Math.log10(curve.x_max);
  const scaleX = (value) => margin.left + (((Math.log10(value) - logMin) / (logMax - logMin || 1)) * innerWidth);
  const scaleY = (value) => margin.top + ((1 - value) * innerHeight);
  const scaledPoints = curve.points.map((point) => ({
    x: scaleX(point.x),
    y: scaleY(point.likelihood),
  }));

  const linePath = scaledPoints
    .map((point, index, points) => {
      if (index === 0) {
        return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      }
      const previous = points[index - 1];
      const midpointX = ((previous.x + point.x) / 2).toFixed(2);
      return `Q ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} ${midpointX} ${((previous.y + point.y) / 2).toFixed(2)} T ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .join(" ");

  const tickValues = [];
  const firstPower = Math.floor(logMin);
  const lastPower = Math.ceil(logMax);
  for (let power = firstPower; power <= lastPower; power += 1) {
    const tick = 10 ** power;
    if (tick >= curve.x_min && tick <= curve.x_max) {
      tickValues.push(tick);
    }
  }
  if (!tickValues.length) {
    tickValues.push(curve.x_min, curve.x_max);
  }

  const markerX = curve.mle_x ? scaleX(curve.mle_x) : null;
  const guideLevels = [0.25, 0.5, 0.75];
  elements.curveCaption.textContent = curve.mle_x
    ? `Relative fit peaks near the estimated MLE of ${curve.mle_label}.`
    : "Updates with the selected wells";

  elements.likelihoodPlot.className = "likelihood-plot";
  elements.likelihoodPlot.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Relative fit plot for the current QLD estimate">
      <rect class="plot-frame" x="${margin.left}" y="${margin.top}" width="${innerWidth}" height="${innerHeight}"></rect>
      ${guideLevels
        .map((level) => {
          const y = scaleY(level);
          return `<line class="plot-guide" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"></line>`;
        })
        .join("")}
      <line class="plot-axis-line" x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${width - margin.right}" y2="${margin.top + innerHeight}"></line>
      <line class="plot-axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerHeight}"></line>
      ${tickValues
        .map((tick) => {
          const x = scaleX(tick);
          return `
            <line class="plot-axis" x1="${x}" y1="${margin.top + innerHeight}" x2="${x}" y2="${margin.top + innerHeight + 8}"></line>
            <text class="plot-label" x="${x}" y="${height - 22}" text-anchor="middle">${tick.toExponential(0).replace("+", "")}</text>
          `;
        })
        .join("")}
      <text class="plot-label" x="${margin.left - 10}" y="${margin.top + innerHeight + 4}" text-anchor="end">0</text>
      <text class="plot-label" x="${margin.left - 10}" y="${margin.top + 6}" text-anchor="end">1</text>
      <text class="plot-axis-title" x="${margin.left + innerWidth / 2}" y="${height - 2}" text-anchor="middle">Cell estimate (log scale)</text>
      <text
        class="plot-axis-title"
        x="16"
        y="${margin.top + innerHeight / 2}"
        text-anchor="middle"
        transform="rotate(-90 16 ${margin.top + innerHeight / 2})"
      >Relative fit</text>
      <path class="plot-curve" d="${linePath}"></path>
      ${
        markerX === null
          ? ""
          : `
            <line class="plot-mle" x1="${markerX}" y1="${margin.top}" x2="${markerX}" y2="${margin.top + innerHeight}"></line>
            <circle class="plot-dot" cx="${markerX}" cy="${scaleY(1)}" r="4"></circle>
            <text class="plot-label" x="${Math.min(markerX + 8, width - margin.right - 12)}" y="${margin.top + 16}">${curve.mle_label}</text>
          `
      }
    </svg>
  `;
}

function updateRowSummaries(observations) {
  observations.forEach((observation, index) => {
    const node = elements.growthGrid.querySelector(`[data-row-summary="${index}"]`);
    if (node) {
      node.textContent = observation.summary;
    }
  });
}

function requestEstimate() {
  if (!state.grid.length) {
    resetResults("Create a grid to begin.");
    return;
  }

  try {
    const payload = estimateQldPayload(state.grid, elements.foldInput.value);
    setStatus(payload.message);
    elements.selectedSummary.textContent = payload.summary || "None yet.";
    elements.mle.textContent = payload.mle_display;
    elements.ci.textContent = payload.ci_display;
    elements.variance.textContent = payload.variance_display;
    state.resultsTsv = payload.results_tsv;
    state.summaryTsv = payload.summary_tsv;
    state.summaryValuesTsv = (payload.summary_values || []).join("\t");
    renderSummaryTable(payload.summary_values || []);
    renderCurve(payload.curve);
    updateRowSummaries(payload.observations || []);
  } catch (error) {
    resetResults(error instanceof Error ? error.message : "Calculation failed.");
  }
}

function scheduleEstimate() {
  if (state.estimateTimer) {
    window.clearTimeout(state.estimateTimer);
  }
  state.estimateTimer = window.setTimeout(() => {
    state.estimateTimer = null;
    requestEstimate();
  }, 120);
}

async function copyText(text, successMessage) {
  if (!text) {
    setStatus("Nothing to copy yet.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus(successMessage);
  } catch (_error) {
    setStatus("Clipboard write failed in this browser.");
  }
}

function createGridFromInputs() {
  try {
    const dilutions = parsePositiveInteger(elements.dilutionCount.value, "Dilutions", 2);
    const replicates = parsePositiveInteger(elements.replicateCount.value, "Replicates", 1);
    state.grid = buildGrid(dilutions, replicates);
    renderGrid();
    requestEstimate();
  } catch (error) {
    resetResults(error instanceof Error ? error.message : "Unable to create grid.");
  }
}

function bindEvents() {
  elements.createGrid.addEventListener("click", createGridFromInputs);
  elements.foldInput.addEventListener("input", scheduleEstimate);
  elements.copySummary.addEventListener("click", () => copyText(state.summaryTsv, "Summary TSV copied."));
  elements.copyResults.addEventListener("click", () => copyText(state.resultsTsv, "Detailed results TSV copied."));
  elements.growthGrid.addEventListener("mouseover", (event) => {
    paintCellFromHoverTarget(event.target.closest("[data-cell]"));
  });
  window.addEventListener("mouseup", clearPointerPaint);
  window.addEventListener("blur", clearPointerPaint);
}

function init() {
  renderSummaryTable(["", "", "", "", ""]);
  bindEvents();
  createGridFromInputs();
}

init();
