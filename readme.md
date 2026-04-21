# Contents
1. `XanthoMoClo-plasmid-copy-number.py` contains analysis code to quantify plasmid copy numbers presented in Soltysiak, Ory et. al.
2. `src/PoissonJoint.py` contains the core logic of estimating the number of targets from a (noisy) serial dilution.
# Limiting Serial Dilutions
The _objective_ of this tool is to estimate with high confidence the number of targets (viable cells/genomes/detectable targets) from a limiting serial dilution of this starting material. A serial dilution is said to be _limiting_ if we fully dilute out the starting sample, that is, we expect to see _empty_ wells at some point in the dilution.

Serial dilutions are modeled as a Poisson process. We use the fact that for an expected number of events `x`, the probability of failure to observe an event is given by

Poisson(0 events | x) = e^(-x)

In a serial diution starting from x cells, the Probability of seeing observing any target, i.e. >0 events can thus be written as 

Poisson(>0 events | x) = 1- e^(-x)


If we are performing an `f` fold serial dilution, the process can be represented as 
product_i=1^(i=k) (Poisson(growth observed well | x/f^k ) for `k` serial dilutions.


We construct the Likelihood function as follows

$$L = \prod_{r=1}^{r=R} \prod_{d=1}^{d=D} (1 - e^{-x/F^d})^{v_{rd}} (e^{-x/F^d})^{1-v_{rd}}$$

We find the number of cells x that maximizes the Log Likelihood.

Further, using the Cramer-Rao bound, we estimate the variance at the MLE to be 

$$\text{Variance} = \frac{-1}{\frac{\partial^2 \ln L}{\partial x^2}}$$

where

$$\frac{\partial^2 \ln L}{\partial x^2} = \sum_{r=1}^{r=R} \sum_{d=1}^{d=D}- \frac{F^{- 2 d} v_{rd} e^{- F^{- d} x}}{1 - e^{- F^{- d} x}} - \frac{F^{- 2 d} v_{rd} e^{- 2 F^{- d} x}}{\left(1 - e^{- F^{- d} x}\right)^{2}}$$

Finally, we compute the 95% CI as MLE $$\pm 1.96 \sqrt \sigma$$ 

## Usage

See `./test.py`

## Static browser calculator

This repository now also includes a GitHub Pages compatible calculator under `docs/`.

- `docs/index.html` is the static entrypoint.
- `docs/qld.js` re-implements the QLD calculation path in browser JavaScript.
- `docs/app.js` renders the manual grid UI, exports, and fit curve with no backend API.
- `docs/.nojekyll` allows direct static serving on GitHub Pages.

### Local preview

You can open `docs/index.html` directly in a browser for quick checks, or serve the folder with any static file server.

### Node regression tests

```bash
npm test
```

These tests verify that the browser implementation stays numerically stable on reference grids and that the site has no runtime backend dependency.

### GitHub Pages deployment

- The static site lives in `docs/`.
- `.github/workflows/pages.yml` deploys that folder with GitHub Actions.
- `.github/workflows/ci.yml` runs the node regression suite on pushes and pull requests.
