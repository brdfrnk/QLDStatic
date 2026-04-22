import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { estimateQldPayload, poissonJoint, shpmError } from "../docs/qld.js";

const fixtures = [
  {
    name: "sample grid with decimal fold",
    fold: 10.15,
    grid: [
      [true, true, false, false],
      [true, false, false, false],
      [false, false, false, false],
    ],
    expected: {
      mle_display: "0.765007",
      ci_display: "-0.211605 to 1.74162",
      variance_display: "0.248275",
      summary: "D1: 2 / 4, D2: 1 / 4, D3: 0 / 4",
    },
  },
  {
    name: "monotonic plate from repo sample",
    fold: 10,
    grid: [
      [true, true, true, true],
      [true, true, true, true],
      [true, true, true, true],
      [true, true, true, true],
      [true, true, true, true],
      [false, true, true, true],
      [true, true, false, true],
      [false, false, false, false],
      [false, false, false, false],
      [false, false, false, false],
      [false, false, false, false],
      [false, false, false, false],
    ],
    expected: {
      mle_display: "1.24956e6",
      ci_display: "-155978 to 2.65509e6",
      variance_display: "5.14246e11",
      summary:
        "D1: 4 / 4, D2: 4 / 4, D3: 4 / 4, D4: 4 / 4, D5: 4 / 4, D6: 3 / 4, D7: 3 / 4, D8: 0 / 4, D9: 0 / 4, D10: 0 / 4, D11: 0 / 4, D12: 0 / 4",
    },
  },
  {
    name: "larger mixed-growth plate",
    fold: 10,
    grid: [
      [true, false, true, true],
      [true, true, true, true],
      [true, true, true, true],
      [true, true, true, true],
      [true, true, true, false],
      [false, false, false, false],
    ],
    expected: {
      mle_display: "12509",
      ci_display: "-1688.52 to 26706.5",
      variance_display: "5.24701e7",
      summary: "D1: 3 / 4, D2: 4 / 4, D3: 4 / 4, D4: 4 / 4, D5: 3 / 4, D6: 0 / 4",
    },
  },
];

test("calculator fixtures remain numerically stable", () => {
  fixtures.forEach((fixture) => {
    const payload = estimateQldPayload(fixture.grid, fixture.fold);
    assert.equal(payload.status, "ok", fixture.name);
    assert.ok(payload.curve, `${fixture.name} has curve`);
    const bestPoint = payload.curve.points.reduce((best, point) =>
      point.likelihood > best.likelihood ? point : best,
    );
    assert.ok(Math.abs(bestPoint.x - payload.mle) / payload.mle < 0.2, `${fixture.name} curve peak tracks MLE`);
    assert.equal(payload.mle_display, fixture.expected.mle_display, `${fixture.name} mle display`);
    assert.equal(payload.ci_display, fixture.expected.ci_display, `${fixture.name} ci display`);
    assert.equal(payload.variance_display, fixture.expected.variance_display, `${fixture.name} variance display`);
    assert.equal(payload.summary, fixture.expected.summary, `${fixture.name} summary`);
    assert.equal(payload.summary_tsv.split("\n")[0], "Dilution factor\tMLE\tCI lower\tCI upper\tVariance");
  });
});

test("invalid inputs surface clear errors", () => {
  assert.throws(() => estimateQldPayload([[true, false]], 10), /At least two dilutions/);
  assert.throws(() => estimateQldPayload([[true], [false, true]], 10), /rectangular/);
  assert.throws(() => estimateQldPayload([[true], [false]], 1), /greater than 1/);
});

test("objective helpers stay finite for typical positive-domain cases", () => {
  const grid = [
    [true, true, false, false],
    [true, false, false, false],
    [false, false, false, false],
  ];
  assert.ok(Number.isFinite(poissonJoint(12, grid, 10.15)));
  assert.ok(Number.isFinite(shpmError(12, grid, 10.15)));
});

test("frontend remains fully static", () => {
  const appSource = fs.readFileSync(path.resolve("docs/app.js"), "utf8");
  const htmlSource = fs.readFileSync(path.resolve("docs/index.html"), "utf8");
  assert.ok(!appSource.includes("fetch("));
  assert.ok(!appSource.includes("/api/"));
  assert.ok(htmlSource.includes("Manual QLD calculator"));
  assert.ok(htmlSource.includes("Relative fit function"));
  assert.ok(!htmlSource.includes(">Utility<"));
  assert.ok(htmlSource.includes('id="dilution-count" type="text" value="6"'));
  assert.ok(htmlSource.includes("Copy results only"));
  assert.ok(htmlSource.includes("Copy results and data input"));
  assert.ok(!htmlSource.includes("Full results TSV"));
});
