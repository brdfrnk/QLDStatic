const DEFAULT_SAMPLE_COUNT = 240;
const SUMMARY_HEADERS = ["Dilution factor", "MLE", "CI lower", "CI upper", "Variance"];
const NON_ZERO_DELTA = 0.05;
const ZERO_DELTA = 0.00025;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatNumber(value) {
  if (!isFiniteNumber(value)) {
    return "N/A";
  }

  let text = Number(value).toPrecision(6);
  text = text.replace(/(\.\d*?[1-9])0+(e[-+]?\d+)?$/, "$1$2");
  text = text.replace(/\.0+(e[-+]?\d+)?$/, "$1");
  text = text.replace(/e\+/, "e");
  return text;
}

function cloneGrid(grid) {
  return grid.map((row) => row.map((value) => Boolean(value)));
}

function validateGrid(grid) {
  if (!Array.isArray(grid) || grid.length < 2) {
    throw new Error("At least two dilutions are required.");
  }

  const replicateCount = Array.isArray(grid[0]) ? grid[0].length : 0;
  if (!Number.isInteger(replicateCount) || replicateCount <= 0) {
    throw new Error("At least one replicate is required.");
  }

  for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex];
    if (!Array.isArray(row) || row.length !== replicateCount) {
      throw new Error("The growth grid must be rectangular.");
    }

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (typeof row[columnIndex] !== "boolean") {
        throw new Error(`Invalid grid value at dilution ${rowIndex + 1}, replicate ${columnIndex + 1}.`);
      }
    }
  }

  return replicateCount;
}

function validateFold(fold) {
  const numericFold = Number(fold);
  if (!isFiniteNumber(numericFold) || numericFold <= 1) {
    throw new Error("Dilution factor must be a number greater than 1.");
  }
  return numericFold;
}

function logOneMinusExpNeg(value) {
  if (!(value > 0)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (value <= Math.log(2)) {
    return Math.log(-Math.expm1(-value));
  }
  return Math.log1p(-Math.exp(-value));
}

export function observationsFromGrid(grid) {
  validateGrid(grid);
  return grid.map((row, dilutionIndex) => {
    const totalWells = row.length;
    const positiveWells = row.reduce((count, value) => count + (value ? 1 : 0), 0);
    return {
      dilution_index: dilutionIndex,
      label: `Dilution ${dilutionIndex + 1}`,
      total_wells: totalWells,
      positive_wells: positiveWells,
      negative_wells: totalWells - positiveWells,
      fraction_positive: totalWells > 0 ? positiveWells / totalWells : null,
      summary: `${positiveWells} / ${totalWells}`,
    };
  });
}

export function poissonJoint(x, grid, fold) {
  if (!(x > 0) || !Number.isFinite(x)) {
    return Number.POSITIVE_INFINITY;
  }

  let logLikelihood = 0;
  for (let dilutionIndex = 0; dilutionIndex < grid.length; dilutionIndex += 1) {
    const row = grid[dilutionIndex];
    const divisor = fold ** dilutionIndex;
    const intensity = x / divisor;
    if (!(intensity >= 0) || !Number.isFinite(intensity)) {
      return Number.POSITIVE_INFINITY;
    }

    for (let replicateIndex = 0; replicateIndex < row.length; replicateIndex += 1) {
      if (row[replicateIndex]) {
        const term = logOneMinusExpNeg(intensity);
        if (!Number.isFinite(term)) {
          return Number.POSITIVE_INFINITY;
        }
        logLikelihood += term;
      } else {
        logLikelihood -= intensity;
      }
    }
  }

  return -logLikelihood;
}

export function shpmError(x, grid, fold) {
  if (!(x > 0) || !Number.isFinite(x)) {
    return Number.POSITIVE_INFINITY;
  }

  const observations = observationsFromGrid(grid);
  let squaredError = 0;

  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    const expected = 1 - Math.exp(-x / (fold ** observation.dilution_index));
    const observed = observation.positive_wells / observation.total_wells;
    const delta = expected - observed;
    squaredError += delta * delta;
  }

  return Math.sqrt(squaredError / observations.length);
}

export function fisherInformation(mle, grid, fold) {
  if (!(mle > 0) || !Number.isFinite(mle)) {
    return Number.NaN;
  }

  const observations = observationsFromGrid(grid);
  let total = 0;

  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    const dilutionScale = fold ** (-observation.dilution_index);
    const numerator = Math.exp(-mle * dilutionScale);
    const denominator = 1 - numerator;
    if (!(denominator > 0)) {
      return Number.NaN;
    }
    total += observation.total_wells * (dilutionScale ** 2) * (numerator / denominator);
  }

  return total;
}

function initialSimplex(x0) {
  if (x0 !== 0) {
    return [x0, x0 * (1 + NON_ZERO_DELTA)];
  }
  return [0, ZERO_DELTA];
}

function sortSimplex(points) {
  points.sort((a, b) => a.fx - b.fx);
}

function evaluatePoint(fn, x) {
  const fx = fn(x);
  return { x, fx: Number.isFinite(fx) ? fx : Number.POSITIVE_INFINITY };
}

function nelderMead1D(fn, x0, options = {}) {
  const alpha = options.alpha ?? 1;
  const gamma = options.gamma ?? 2;
  const rho = options.rho ?? 0.5;
  const sigma = options.sigma ?? 0.5;
  const maxIterations = options.maxIterations ?? 200;
  const xTolerance = options.xTolerance ?? 1e-4;
  const fTolerance = options.fTolerance ?? 1e-4;

  const simplex = initialSimplex(x0).map((x) => evaluatePoint(fn, x));
  sortSimplex(simplex);
  if (!Number.isFinite(simplex[0].fx) && !Number.isFinite(simplex[1].fx)) {
    return { success: false, x: x0, fx: Number.POSITIVE_INFINITY, iterations: 0 };
  }

  let iterations = 0;
  while (iterations < maxIterations) {
    sortSimplex(simplex);
    const [best, worst] = simplex;
    const xSpread = Math.max(...simplex.map((point) => Math.abs(point.x - best.x)));
    const fSpread = Math.max(...simplex.map((point) => Math.abs(point.fx - best.fx)));

    if (xSpread <= xTolerance && fSpread <= fTolerance) {
      return { success: true, x: best.x, fx: best.fx, iterations };
    }

    const centroid = best.x;
    const reflected = evaluatePoint(fn, centroid + alpha * (centroid - worst.x));

    if (reflected.fx < best.fx) {
      const expanded = evaluatePoint(fn, centroid + gamma * (reflected.x - centroid));
      simplex[1] = expanded.fx < reflected.fx ? expanded : reflected;
    } else if (reflected.fx < worst.fx) {
      simplex[1] = reflected;
    } else {
      const contracted = evaluatePoint(
        fn,
        centroid + rho * ((reflected.fx < worst.fx ? reflected.x : worst.x) - centroid),
      );
      if (contracted.fx < worst.fx) {
        simplex[1] = contracted;
      } else {
        simplex[1] = evaluatePoint(fn, best.x + sigma * (worst.x - best.x));
      }
    }

    iterations += 1;
  }

  sortSimplex(simplex);
  return {
    success: simplex.every((point) => Number.isFinite(point.fx)),
    x: simplex[0].x,
    fx: simplex[0].fx,
    iterations,
  };
}

export function quantifyInputFromSerialDilution(grid, fold) {
  validateGrid(grid);
  const numericFold = validateFold(fold);
  const growthTable = cloneGrid(grid);

  let solution = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    solution = nelderMead1D(
      (value) => poissonJoint(value, growthTable, numericFold),
      10 ** attempt,
    );
    if (solution.success) {
      break;
    }
  }

  if (!solution || !solution.success || !(solution.x > 0)) {
    return {
      mle: null,
      lower: null,
      upper: null,
      variance: null,
      status: "error",
      message: "QLD calculation failed.",
    };
  }

  const shpmSolution = nelderMead1D(
    (value) => shpmError(value, growthTable, numericFold),
    solution.x,
  );
  const mle = shpmSolution.x;
  const information = fisherInformation(mle, growthTable, numericFold);
  const variance = information > 0 ? 1 / information : Number.NaN;
  const standardDeviation = Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : Number.NaN;
  const lower = Number.isFinite(standardDeviation) ? mle - (1.96 * standardDeviation) : Number.NaN;
  const upper = Number.isFinite(standardDeviation) ? mle + (1.96 * standardDeviation) : Number.NaN;

  return {
    mle,
    lower,
    upper,
    variance,
    status: "ok",
    message: "Estimate computed.",
  };
}

export function buildResultsTsv(observations, fold, result) {
  const lines = ["Dilution\tReplicates\tPositive\tNegative\tFraction Positive"];

  for (const observation of observations) {
    lines.push(
      [
        observation.label,
        String(observation.total_wells),
        String(observation.positive_wells),
        String(observation.negative_wells),
        observation.fraction_positive === null ? "N/A" : formatNumber(observation.fraction_positive),
      ].join("\t"),
    );
  }

  lines.push("");
  lines.push("Metric\tValue");
  lines.push(`Dilution factor\t${formatNumber(fold)}`);
  lines.push(`Status\t${result.status}`);
  lines.push(`Message\t${result.message}`);
  lines.push(`MLE\t${formatNumber(result.mle)}`);
  lines.push(`CI lower\t${formatNumber(result.lower)}`);
  lines.push(`CI upper\t${formatNumber(result.upper)}`);
  lines.push(`Variance\t${formatNumber(result.variance)}`);
  return lines.join("\n");
}

export function buildSummaryTsv(fold, result) {
  return [
    SUMMARY_HEADERS.join("\t"),
    [
      formatNumber(fold),
      formatNumber(result.mle),
      formatNumber(result.lower),
      formatNumber(result.upper),
      formatNumber(result.variance),
    ].join("\t"),
  ].join("\n");
}

function curveUpperBound(observations, fold, result) {
  const scaleHint = Math.max(...observations.map((observation) => fold ** observation.dilution_index));
  const candidates = [1, scaleHint];

  if (isFiniteNumber(result.mle) && result.mle > 0) {
    candidates.push(result.mle * 2.5);
    candidates.push(result.mle + (4 * Math.sqrt(Math.max(result.variance ?? 0, 0))));
  }
  if (isFiniteNumber(result.upper) && result.upper > 0) {
    candidates.push(result.upper * 1.15);
  }

  return Math.max(...candidates.filter((value) => Number.isFinite(value) && value > 0));
}

function curveLowerBound(xMax, result) {
  const candidates = [xMax / 1000, 1e-9];
  if (isFiniteNumber(result.mle) && result.mle > 0) {
    candidates.push(result.mle / 40);
  }
  if (isFiniteNumber(result.lower) && result.lower > 0) {
    candidates.push(result.lower / 3);
  }
  return Math.max(1e-9, Math.min(...candidates.filter((value) => value > 0 && Number.isFinite(value))));
}

export function buildLikelihoodCurve(grid, fold, result, sampleCount = DEFAULT_SAMPLE_COUNT) {
  const observations = observationsFromGrid(grid);
  if (result.status !== "ok") {
    return null;
  }

  const xMax = curveUpperBound(observations, fold, result);
  let xMin = curveLowerBound(xMax, result);
  if (!(xMin > 0) || xMin >= xMax) {
    xMin = Math.max(xMax / 1000, 1e-9);
  }

  const logMin = Math.log10(xMin);
  const logMax = Math.log10(xMax);
  const xValues = [];
  const objectiveValues = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const x = 10 ** (logMin + (((logMax - logMin) * index) / (sampleCount - 1)));
    xValues.push(x);
    objectiveValues.push(poissonJoint(x, grid, fold));
  }

  const finiteValues = objectiveValues.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return null;
  }

  let peakIndex = 0;
  let peakObjective = Number.POSITIVE_INFINITY;
  objectiveValues.forEach((value, index) => {
    if (Number.isFinite(value) && value < peakObjective) {
      peakObjective = value;
      peakIndex = index;
    }
  });

  return {
    x_min: xMin,
    x_max: xMax,
    peak_x: xValues[peakIndex],
    peak_label: formatNumber(xValues[peakIndex]),
    points: xValues.map((x, index) => ({
      x,
      likelihood: Number.isFinite(objectiveValues[index]) ? Math.exp(-(objectiveValues[index] - peakObjective)) : 0,
    })),
  };
}

export function estimateQldPayload(grid, fold) {
  const numericFold = validateFold(fold);
  const observations = observationsFromGrid(grid);
  const result = quantifyInputFromSerialDilution(grid, numericFold);
  const summaryValues = [
    formatNumber(numericFold),
    formatNumber(result.mle),
    formatNumber(result.lower),
    formatNumber(result.upper),
    formatNumber(result.variance),
  ];

  return {
    fold: numericFold,
    status: result.status,
    message: result.message,
    mle: result.mle,
    lower: result.lower,
    upper: result.upper,
    variance: result.variance,
    mle_display: formatNumber(result.mle),
    ci_display:
      isFiniteNumber(result.lower) && isFiniteNumber(result.upper)
        ? `${formatNumber(result.lower)} to ${formatNumber(result.upper)}`
        : "N/A",
    variance_display: formatNumber(result.variance),
    summary: observations.map((observation, index) => `D${index + 1}: ${observation.summary}`).join(", "),
    summary_headers: SUMMARY_HEADERS.slice(),
    summary_values: summaryValues,
    summary_tsv: buildSummaryTsv(numericFold, result),
    results_tsv: buildResultsTsv(observations, numericFold, result),
    curve: buildLikelihoodCurve(grid, numericFold, result),
    observations,
  };
}
