import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const TAU = Math.PI * 2;
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const GOLDEN_ANGLE = 360 * (1 - 1 / GOLDEN_RATIO);
const DISPLAY_RADIUS_SCALE = 0.018333333333333333;
const PARTICLE_CULL_RADIUS = 1.2 / DISPLAY_RADIUS_SCALE;
const DEFAULT_WAIT_MS = 16;
const G_PRESETS = [3, 2, 1.5, 1, 0.7, 0.5, 0.2, 0.14, 0.044];
const SCHEDULE_PRESETS = {
  g3to07: {
    label: "G=3.0 -> 0.7",
    note: "G=3.0 -> 0.7",
    start: 3,
    target: 0.7,
    holdBirths: 120,
    rampBirths: 680,
    total: 900,
  },
  g07to05: {
    label: "G=0.7 -> 0.5",
    note: "G=0.7 -> 0.5",
    start: 0.7,
    target: 0.5,
    holdBirths: 0,
    rampBirths: 500,
    extensionBirths: 700,
    requiresRecordedState: true,
  },
  g05to014: {
    label: "G=0.5 -> 0.14",
    note: "G=0.5 -> 0.14",
    start: 0.5,
    target: 0.14,
    holdBirths: 0,
    rampBirths: 1400,
    extensionBirths: 2200,
    requiresRecordedState: true,
  },
  g014to0044: {
    label: "G=0.14 -> 0.044",
    note: "G=0.14 -> 0.044",
    start: 0.14,
    target: 0.044,
    holdBirths: 0,
    rampBirths: 1800,
    extensionBirths: 2800,
    requiresRecordedState: true,
  },
};

const DEFAULTS = {
  initialRadius: 5,
  speed: 0.25,
  T: 2,
  schedule: "fixed",
  total: 900,
  N: 36000,
  M: 15,
  waitMs: DEFAULT_WAIT_MS,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function signedAngleDifference(next, previous) {
  return Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sampleRing(N) {
  return Array.from({ length: N }, (_, index) => {
    const theta = (index / N) * TAU;
    return {
      theta,
      cosTheta: Math.cos(theta),
      sinTheta: Math.sin(theta),
    };
  });
}

function potentialAt(cosTheta, sinTheta, birthRadius, particles) {
  let total = 0;
  let compensation = 0;

  for (const particle of particles) {
    const dx = birthRadius * cosTheta - particle.radius * particle.cosTheta;
    const dy = birthRadius * sinTheta - particle.radius * particle.sinTheta;
    const distance = Math.max(Math.hypot(dx, dy), 0.0001);
    const term = 1 / (distance * distance * distance * distance);
    const corrected = term - compensation;
    const next = total + corrected;
    compensation = (next - total) - corrected;
    total = next;
  }

  return total;
}

function fixedG(settings) {
  return (settings.T * settings.speed) / settings.initialRadius;
}

function scheduledG(settings, born) {
  const preset = SCHEDULE_PRESETS[settings.schedule];
  if (!preset) return fixedG(settings);

  const holdBirths = settings.rampStartBorn ?? preset.holdBirths;
  if (born <= holdBirths) return preset.start;

  const progress = clamp(
    (born - holdBirths) / preset.rampBirths,
    0,
    1,
  );
  const eased = 1 - Math.exp(-4 * progress);
  if (progress >= 1) return preset.target;

  return preset.start + (preset.target - preset.start) * eased;
}

function growthPerBirthAt(settings, born) {
  return scheduledG(settings, born) * settings.initialRadius;
}

function tForG(settings, g) {
  return (g * settings.initialRadius) / settings.speed;
}

function formatGValue(g) {
  if (g < 0.1) return g.toFixed(3);
  return g.toFixed(g >= 1 ? 1 : 2);
}

function createInitialState(settings) {
  const growthPerBirth = growthPerBirthAt(settings, 1);
  return {
    particles: [
      {
        id: 0,
        theta: 0,
        cosTheta: 1,
        sinTheta: 0,
        radius: settings.initialRadius + growthPerBirth,
      },
    ],
    angles: [0],
    divergences: [],
    born: 1,
    finished: false,
  };
}

function cloneState(state, overrides = {}) {
  return {
    particles: state.particles.map((particle) => ({ ...particle })),
    angles: [...state.angles],
    divergences: [...state.divergences],
    born: state.born,
    finished: state.finished,
    ...overrides,
  };
}

function birthOne(state, settings, samples) {
  const growthPerBirth = growthPerBirthAt(settings, state.born);
  const recent = state.particles.slice(-settings.M);
  let bestTheta = 0;
  let bestEnergy = Number.POSITIVE_INFINITY;

  for (const sample of samples) {
    const energy = potentialAt(
      sample.cosTheta,
      sample.sinTheta,
      settings.initialRadius,
      recent,
    );
    if (energy < bestEnergy) {
      bestEnergy = energy;
      bestTheta = sample.theta;
    }
  }

  const previousTheta = state.angles[state.angles.length - 1];
  state.divergences.push(Math.abs(signedAngleDifference(bestTheta, previousTheta)));
  state.angles.push(bestTheta);
  state.particles.push({
    id: state.born,
    theta: bestTheta,
    cosTheta: Math.cos(bestTheta),
    sinTheta: Math.sin(bestTheta),
    radius: settings.initialRadius,
  });
  state.born += 1;

  for (const particle of state.particles) {
    particle.radius += growthPerBirth;
  }
  state.particles = state.particles.filter(
    (particle) => particle.radius <= PARTICLE_CULL_RADIUS,
  );
}

function advanceState(current, settings, samples) {
  const next = {
    particles: current.particles.map((particle) => ({ ...particle })),
    angles: [...current.angles],
    divergences: [...current.divergences],
    born: current.born,
    finished: false,
  };

  for (let index = 0; index < settings.skip; index += 1) {
    if (next.born >= settings.total) {
      next.finished = true;
      break;
    }
    birthOne(next, settings, samples);
  }

  next.finished = next.born >= settings.total;
  return next;
}

function visiblePoints(state, scale) {
  if (!state) return [];

  return state.particles
    .map((particle, index) => {
      const radius = scale * particle.radius;
      if (radius > 1) return null;
      return {
        index,
        originalIndex: particle.id,
        theta: particle.theta,
        radius,
        x: Math.cos(particle.theta) * radius,
        y: Math.sin(particle.theta) * radius,
      };
    })
    .filter(Boolean);
}

function currentDivergenceDegrees(state) {
  if (!state || !state.divergences.length) return null;
  return (median(state.divergences.slice(-36)) * 180) / Math.PI;
}

function dominantGap(points, direction) {
  const gapScores = new Map();

  for (const point of points) {
    let best = null;

    for (const candidate of points) {
      if (candidate.radius <= point.radius) continue;
      const gap = Math.abs(candidate.originalIndex - point.originalIndex);
      if (gap < 2) continue;

      const delta = signedAngleDifference(candidate.theta, point.theta);
      if (direction === "right" && delta >= 0) continue;
      if (direction === "left" && delta <= 0) continue;
      if (Math.abs(delta) > 1.25) continue;

      const radialGap = candidate.radius - point.radius;
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      const score = distance + radialGap * 0.25;
      if (!best || score < best.score) {
        best = { gap, score };
      }
    }

    if (!best) continue;
    const current = gapScores.get(best.gap) ?? { count: 0, score: 0 };
    current.count += 1;
    current.score += best.score;
    gapScores.set(best.gap, current);
  }

  const dominant = [...gapScores.entries()]
    .map(([gap, value]) => ({
      gap,
      count: value.count,
      score: value.score / value.count,
    }))
    .sort((a, b) => b.count - a.count || a.score - b.score)[0];

  return dominant?.gap ?? 0;
}

function buildSegments(points, gap, direction) {
  if (!gap) return [];
  const byId = new Map(points.map((point) => [point.originalIndex, point]));
  const segments = [];

  for (const point of points) {
    if (point.radius < 0.09) continue;
    const next = byId.get(point.originalIndex - gap);
    if (!next || next.radius <= point.radius || next.radius > 0.99) continue;

    const delta = signedAngleDifference(next.theta, point.theta);
    if (direction === "right" && delta >= 0) continue;
    if (direction === "left" && delta <= 0) continue;
    segments.push([point, next]);
  }

  return segments;
}

function unwrapByRadius(path) {
  if (!path.length) return [];
  let theta = path[0].theta;
  const unwrapped = [{ ...path[0], unwrappedTheta: theta }];

  for (let index = 1; index < path.length; index += 1) {
    theta += signedAngleDifference(path[index].theta, path[index - 1].theta);
    unwrapped.push({ ...path[index], unwrappedTheta: theta });
  }

  return unwrapped;
}

function fitArchimedean(points) {
  const n = points.length;
  const sumTheta = points.reduce((sum, point) => sum + point.unwrappedTheta, 0);
  const sumRadius = points.reduce((sum, point) => sum + point.radius, 0);
  const sumThetaRadius = points.reduce(
    (sum, point) => sum + point.unwrappedTheta * point.radius,
    0,
  );
  const sumTheta2 = points.reduce(
    (sum, point) => sum + point.unwrappedTheta * point.unwrappedTheta,
    0,
  );
  const denominator = n * sumTheta2 - sumTheta * sumTheta;
  if (Math.abs(denominator) < 0.000001) return null;

  const a = (n * sumThetaRadius - sumTheta * sumRadius) / denominator;
  const b = (sumRadius - a * sumTheta) / n;
  return { a, b };
}

function sampleArchimedeanPath(points, innerRadius) {
  const unwrapped = unwrapByRadius(points);
  const fit = fitArchimedean(unwrapped);
  if (!fit) return points;

  const thetaStart = unwrapped[0].unwrappedTheta;
  const thetaEnd = unwrapped[unwrapped.length - 1].unwrappedTheta;
  const thetaInner =
    Math.abs(fit.a) > 0.000001
      ? (innerRadius - fit.b) / fit.a
      : thetaStart;
  const outerRadius = 0.99;
  const thetaOuter =
    Math.abs(fit.a) > 0.000001
      ? (outerRadius - fit.b) / fit.a
      : thetaEnd;
  const extendedThetaStart =
    thetaEnd >= thetaStart
      ? Math.min(thetaStart, thetaInner)
      : Math.max(thetaStart, thetaInner);
  const extendedThetaEnd =
    thetaEnd >= thetaStart
      ? Math.max(thetaEnd, thetaOuter)
      : Math.min(thetaEnd, thetaOuter);
  const steps = Math.max(18, Math.min(72, unwrapped.length * 18));
  const sampled = [];

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const theta = extendedThetaStart + (extendedThetaEnd - extendedThetaStart) * t;
    const radius = fit.a * theta + fit.b;
    if (radius < innerRadius || radius > outerRadius) continue;
    sampled.push({
      theta,
      radius,
      x: Math.cos(theta) * radius,
      y: Math.sin(theta) * radius,
    });
  }

  return sampled.length >= 3 ? sampled : points;
}

function buildArchimedeanPaths(points, gap, innerRadius) {
  if (!gap) return [];
  const paths = [];

  for (let start = 0; start < gap; start += 1) {
    const path = points
      .filter((point) => point.originalIndex % gap === start)
      .filter((point) => point.radius >= 0.04 && point.radius <= 0.98)
      .sort((a, b) => a.radius - b.radius);

    if (path.length >= 2) {
      paths.push(sampleArchimedeanPath(path, innerRadius));
    }
  }

  return paths;
}

function preferredSpiralPair(g) {
  if (g >= 0.035 && g <= 0.06) return { right: 13, left: 21 };
  if (g >= 0.1 && g <= 0.18) return { right: 8, left: 13 };
  if (g >= 0.45 && g <= 0.58) return { right: 5, left: 8 };
  if (g >= 0.62 && g <= 0.78) return { right: 3, left: 5 };
  return null;
}

function analyzeSpirals(points, innerRadius, preferredPair) {
  const rightGap = preferredPair?.right ?? dominantGap(points, "right");
  const leftGap = preferredPair?.left ?? dominantGap(points, "left");

  return {
    right: {
      count: rightGap,
      paths: buildArchimedeanPaths(points, rightGap, innerRadius),
    },
    left: {
      count: leftGap,
      paths: buildArchimedeanPaths(points, leftGap, innerRadius),
    },
  };
}

function project(point, size) {
  const scale = size / 2 - 30;
  return {
    x: size / 2 + point.x * scale,
    y: size / 2 + point.y * scale,
  };
}

function SimulationView({ points, spirals, initialRadius, showSpirals }) {
  const size = 640;
  const renderPath = (path) => {
    const projected = path.map((point) => project(point, size));
    if (projected.length < 2) return "";
    if (projected.length === 2) {
      const [first, second] = projected;
      return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} L ${second.x.toFixed(2)} ${second.y.toFixed(2)}`;
    }

    let d = `M ${projected[0].x.toFixed(2)} ${projected[0].y.toFixed(2)}`;
    for (let index = 0; index < projected.length - 1; index += 1) {
      const p0 = projected[Math.max(0, index - 1)];
      const p1 = projected[index];
      const p2 = projected[index + 1];
      const p3 = projected[Math.min(projected.length - 1, index + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    return d;
  };

  return (
    <svg className="sim-svg" viewBox={`0 0 ${size} ${size}`} role="img">
      <circle className="field" cx={size / 2} cy={size / 2} r={size / 2 - 24} />
      <circle
        className="birth-ring"
        cx={size / 2}
        cy={size / 2}
        r={(size / 2 - 30) * DISPLAY_RADIUS_SCALE * initialRadius}
      />
      {showSpirals && (
        <g className="spirals">
          <g className="right-spirals">
            {spirals.right.paths.map((path, index) => (
              <path key={`r-${index}`} d={renderPath(path)} />
            ))}
          </g>
          <g className="left-spirals">
            {spirals.left.paths.map((path, index) => (
              <path key={`l-${index}`} d={renderPath(path)} />
            ))}
          </g>
        </g>
      )}
      <g>
        {points.map((point) => {
          const p = project(point, size);
          return (
            <circle
              key={point.originalIndex}
              className="particle"
              cx={p.x}
              cy={p.y}
              r={6}
            />
          );
        })}
      </g>
    </svg>
  );
}

function NumberField({ label, value, min, max, step, onChange, format = (number) => number }) {
  return (
    <label className="control">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{format(value)}</output>
    </label>
  );
}

function statusText(state, running, showSpirals) {
  if (!state) return "未開始";
  if (showSpirals) return "螺旋表示";
  if (running) return "計算中";
  if (state.finished) return "計算完了";
  return "一時停止";
}

function App() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [state, setState] = useState(null);
  const [running, setRunning] = useState(false);
  const [showSpirals, setShowSpirals] = useState(false);
  const [recordedBase, setRecordedBase] = useState(null);
  const [recordedG05Base, setRecordedG05Base] = useState(null);
  const [recordedG014Base, setRecordedG014Base] = useState(null);
  const samples = useMemo(() => sampleRing(settings.N), [settings.N]);
  const currentBorn = state?.born ?? 0;
  const G = scheduledG(settings, currentBorn);
  const currentT = tForG(settings, G);
  const growthPerBirth = G * settings.initialRadius;
  const modelSettings = useMemo(
    () => ({
      ...settings,
      skip: 1,
    }),
    [settings],
  );
  const points = useMemo(() => visiblePoints(state, DISPLAY_RADIUS_SCALE), [state]);
  const birthDisplayRadius = DISPLAY_RADIUS_SCALE * settings.initialRadius;
  const preferredPair = useMemo(() => preferredSpiralPair(G), [G]);
  const spirals = useMemo(
    () =>
      showSpirals
        ? analyzeSpirals(points, birthDisplayRadius, preferredPair)
        : { right: { count: 0, paths: [] }, left: { count: 0, paths: [] } },
    [points, showSpirals, birthDisplayRadius, preferredPair],
  );
  const divergence = currentDivergenceDegrees(state);
  const status = statusText(state, running, showSpirals);
  const progress = state ? (state.born / settings.total) * 100 : 0;

  useEffect(() => {
    if (!running) return undefined;

    let lastTick = window.performance.now();
    let accumulatedSteps = 0;
    const timer = window.setInterval(() => {
      const now = window.performance.now();
      accumulatedSteps += (now - lastTick) / settings.waitMs;
      lastTick = now;

      const maxStepsPerTick = Math.max(1, Math.floor(120000 / settings.N));
      const steps = Math.min(maxStepsPerTick, Math.floor(accumulatedSteps));
      if (steps < 1) return;
      accumulatedSteps -= steps;

      setState((current) => {
        if (!current) return current;
        const next = advanceState(
          current,
          {
            ...modelSettings,
            skip: steps,
          },
          samples,
        );
        if (next.finished) setRunning(false);
        return next;
      });
    }, settings.waitMs);

    return () => window.clearInterval(timer);
  }, [running, modelSettings, samples, settings.waitMs]);

  useEffect(() => {
    if (running || !state?.finished) return;

    if (settings.schedule === "g3to07" && !recordedBase) {
      setRecordedBase({
        g: G,
        settings: {
          ...settings,
          schedule: "fixed",
          rampStartBorn: undefined,
          total: state.born,
          T: Number(tForG(settings, 0.7).toFixed(4)),
        },
        state: cloneState(state, { finished: false }),
      });
      setShowSpirals(true);
      return;
    }

    if (settings.schedule === "g07to05" && !showSpirals) {
      if (!recordedG05Base) {
        setRecordedG05Base({
          g: G,
          settings: {
            ...settings,
            schedule: "fixed",
            rampStartBorn: undefined,
            total: state.born,
            T: Number(tForG(settings, 0.5).toFixed(4)),
          },
          state: cloneState(state, { finished: false }),
        });
      }
      setShowSpirals(true);
      return;
    }

    if (settings.schedule === "g05to014" && !showSpirals) {
      if (!recordedG014Base) {
        setRecordedG014Base({
          g: G,
          settings: {
            ...settings,
            schedule: "fixed",
            rampStartBorn: undefined,
            total: state.born,
            T: Number(tForG(settings, 0.14).toFixed(4)),
          },
          state: cloneState(state, { finished: false }),
        });
      }
      setShowSpirals(true);
      return;
    }

    if (settings.schedule === "g014to0044" && !showSpirals) {
      setShowSpirals(true);
    }
  }, [
    G,
    recordedBase,
    recordedG014Base,
    recordedG05Base,
    running,
    settings,
    showSpirals,
    state,
  ]);

  const update = (key, value) => {
    setRunning(false);
    setShowSpirals(false);
    setState(null);
    if (key !== "waitMs") {
      setRecordedBase(null);
      setRecordedG05Base(null);
      setRecordedG014Base(null);
    }
    setSettings((current) => ({
      ...current,
      [key]: value,
      ...(key === "T" ? { schedule: "fixed" } : {}),
    }));
  };

  const start = () => {
    setShowSpirals(false);
    if (settings.schedule === "g07to05" && recordedBase) {
      setState(cloneState(recordedBase.state, { finished: false }));
    } else if (settings.schedule === "g05to014" && recordedG05Base) {
      setState(cloneState(recordedG05Base.state, { finished: false }));
    } else if (settings.schedule === "g014to0044" && recordedG014Base) {
      setState(cloneState(recordedG014Base.state, { finished: false }));
    } else {
      setState(createInitialState(modelSettings));
    }
    setRunning(true);
  };

  const pause = () => {
    setRunning(false);
  };

  const resume = () => {
    if (state && !state.finished) {
      setShowSpirals(false);
      setRunning(true);
    }
  };

  const reset = () => {
    setRunning(false);
    setShowSpirals(false);
    setState(null);
  };

  const applyG = (targetG) => {
    setRunning(false);
    setShowSpirals(false);
    setRecordedBase(null);
    setRecordedG05Base(null);
    setRecordedG014Base(null);
    setState(null);
    setSettings((current) => ({
      ...current,
      schedule: "fixed",
      rampStartBorn: undefined,
      T: Number(tForG(current, targetG).toFixed(4)),
    }));
  };

  const applySchedulePreset = (scheduleKey) => {
    const preset = SCHEDULE_PRESETS[scheduleKey];
    if (!preset) return;

    setRunning(false);
    setShowSpirals(false);
    setRecordedBase(null);
    setRecordedG05Base(null);
    setRecordedG014Base(null);
    setState(null);
    setSettings((current) => ({
      ...current,
      schedule: scheduleKey,
      rampStartBorn: undefined,
      total: Math.max(current.total, preset.total),
      T: Number(tForG(current, preset.start).toFixed(4)),
    }));
  };

  const startFromRecordedG07 = () => {
    const preset = SCHEDULE_PRESETS.g07to05;
    if (!recordedBase) return;

    const nextSettings = {
      ...recordedBase.settings,
      schedule: "g07to05",
      rampStartBorn: recordedBase.state.born,
      total: Math.max(
        settings.total,
        recordedBase.state.born + preset.extensionBirths,
      ),
      waitMs: settings.waitMs,
      T: Number(tForG(recordedBase.settings, preset.start).toFixed(4)),
    };

    setSettings(nextSettings);
    setShowSpirals(false);
    setRecordedG05Base(null);
    setRecordedG014Base(null);
    setState(cloneState(recordedBase.state, { finished: false }));
    setRunning(true);
  };

  const startFromRecordedG05 = () => {
    const preset = SCHEDULE_PRESETS.g05to014;
    if (!recordedG05Base) return;

    const nextSettings = {
      ...recordedG05Base.settings,
      schedule: "g05to014",
      rampStartBorn: recordedG05Base.state.born,
      total: Math.max(
        settings.total,
        recordedG05Base.state.born + preset.extensionBirths,
      ),
      waitMs: settings.waitMs,
      T: Number(tForG(recordedG05Base.settings, preset.start).toFixed(4)),
    };

    setSettings(nextSettings);
    setShowSpirals(false);
    setRecordedG014Base(null);
    setState(cloneState(recordedG05Base.state, { finished: false }));
    setRunning(true);
  };

  const startFromRecordedG014 = () => {
    const preset = SCHEDULE_PRESETS.g014to0044;
    if (!recordedG014Base) return;

    const nextSettings = {
      ...recordedG014Base.settings,
      schedule: "g014to0044",
      rampStartBorn: recordedG014Base.state.born,
      total: Math.max(
        settings.total,
        recordedG014Base.state.born + preset.extensionBirths,
      ),
      waitMs: settings.waitMs,
      T: Number(tForG(recordedG014Base.settings, preset.start).toFixed(4)),
    };

    setSettings(nextSettings);
    setShowSpirals(false);
    setState(cloneState(recordedG014Base.state, { finished: false }));
    setRunning(true);
  };

  return (
    <main className="sim-app">
      <section className="workbench">
        <div className="canvas-panel">
          <header className="topbar">
            <div>
              <p>Douady-Couder simulator</p>
              <h1>葉序シミュレーター</h1>
            </div>
            <span className={`status ${running ? "is-running" : ""}`}>{status}</span>
          </header>

          <div className="canvas-stage">
            <SimulationView
              points={points}
              spirals={spirals}
              initialRadius={settings.initialRadius}
              showSpirals={showSpirals}
            />
          </div>

          <div className="formula-bar">
            <span>
              G = V<sub>0</sub>T / R<sub>0</sub> = {G.toFixed(3)}
            </span>
            <span>T = {currentT.toFixed(2)}</span>
            <span>
              V<sub>0</sub> = {settings.speed.toFixed(2)}
            </span>
            <span>
              R<sub>0</sub> = {settings.initialRadius}
            </span>
          </div>
        </div>

        <aside className="control-panel">
          <section className="panel-section summary">
            <p className="section-label">model</p>
            <p className="lead">
              R<sub>0</sub> と V<sub>0</sub> は固定します。
              G は T を換算して制御します。
            </p>
          </section>

          <section className="g-readout">
            <span>G</span>
            <strong>{G.toFixed(3)}</strong>
            <small>
              {SCHEDULE_PRESETS[settings.schedule]
                ? SCHEDULE_PRESETS[settings.schedule].note
                : (
                    <>
                      G = V<sub>0</sub>T / R<sub>0</sub>
                    </>
                  )}
            </small>
          </section>

          <section className="metrics">
            <div>
              <span>発散角</span>
              <strong>{divergence ? `${divergence.toFixed(2)}°` : "-"}</strong>
            </div>
            <div>
              <span>発生数</span>
              <strong>{state ? `${state.born}/${settings.total}` : "-"}</strong>
            </div>
            <div>
              <span>螺旋数</span>
              <strong>
                {showSpirals ? `${spirals.right.count} / ${spirals.left.count}` : "-"}
              </strong>
            </div>
          </section>

          <div className="progress-track" aria-label="計算進捗">
            <span style={{ width: `${progress}%` }} />
          </div>

          <section className="panel-section">
            <div className="section-header">
              <p className="section-label">parameters</p>
              <button
                className="text-button"
                onClick={() => {
                  setRunning(false);
                  setShowSpirals(false);
                  setState(null);
                  setRecordedBase(null);
                  setRecordedG05Base(null);
                  setRecordedG014Base(null);
                  setSettings((current) => ({
                    ...current,
                    initialRadius: 5,
                    speed: 0.25,
                    T: 2,
                    schedule: "fixed",
                    rampStartBorn: undefined,
                    N: 36000,
                    M: 15,
                    waitMs: DEFAULT_WAIT_MS,
                  }));
                }}
              >
                G=0.1 基準
              </button>
            </div>
            <NumberField
              label="T"
              min="0.2"
              max="80"
              step="0.1"
              value={settings.T}
              onChange={(value) => update("T", value)}
              format={(value) => value.toFixed(2)}
            />
            <div className="preset-grid" aria-label="代表的なG">
              {G_PRESETS.map((preset) => (
                <button
                  key={preset}
                  className={
                    settings.schedule === "fixed" && Math.abs(G - preset) < 0.001
                      ? "g-preset is-active"
                      : "g-preset"
                  }
                  onClick={() => applyG(preset)}
                >
                  G {formatGValue(preset)}
                </button>
              ))}
            </div>
            {Object.entries(SCHEDULE_PRESETS)
              .filter(([, preset]) => !preset.requiresRecordedState)
              .map(([key, preset]) => (
              <button
                key={key}
                className={settings.schedule === key ? "schedule-preset is-active" : "schedule-preset"}
                onClick={() => applySchedulePreset(key)}
              >
                {preset.label}
              </button>
            ))}
            <button
              className={settings.schedule === "g07to05" ? "schedule-preset is-active" : "schedule-preset"}
              disabled={running || !recordedBase}
              onClick={startFromRecordedG07}
            >
              {SCHEDULE_PRESETS.g07to05.label}
            </button>
            <button
              className={settings.schedule === "g05to014" ? "schedule-preset is-active" : "schedule-preset"}
              disabled={running || !recordedG05Base}
              onClick={startFromRecordedG05}
            >
              {SCHEDULE_PRESETS.g05to014.label}
            </button>
            <button
              className={settings.schedule === "g014to0044" ? "schedule-preset is-active" : "schedule-preset"}
              disabled={running || !recordedG014Base}
              onClick={startFromRecordedG014}
            >
              {SCHEDULE_PRESETS.g014to0044.label}
            </button>
            <NumberField
              label="総数"
              min="120"
              max={Math.max(2400, settings.total)}
              step="20"
              value={settings.total}
              onChange={(value) => update("total", value)}
            />
            <NumberField
              label="M"
              min="1"
              max="60"
              step="1"
              value={settings.M}
              onChange={(value) => update("M", value)}
            />
            <NumberField
              label="wait"
              min="16"
              max="300"
              step="2"
              value={settings.waitMs}
              onChange={(value) => update("waitMs", value)}
              format={(value) => `${value}ms`}
            />
          </section>

          <section className="actions">
            <button onClick={start}>
              {(settings.schedule === "g07to05" && recordedBase) ||
              (settings.schedule === "g05to014" && recordedG05Base) ||
              (settings.schedule === "g014to0044" && recordedG014Base)
                ? "接続して計算"
                : "最初から計算"}
            </button>
            {running ? (
              <button className="secondary" onClick={pause}>一時停止</button>
            ) : (
              <button className="secondary" disabled={!state || state.finished} onClick={resume}>
                再開
              </button>
            )}
            <button className="secondary" onClick={reset}>リセット</button>
            <button
              className="secondary"
              disabled={!state || running || !points.length}
              onClick={() => setShowSpirals(true)}
            >
              螺旋を描く
            </button>
          </section>

          <section className="readout">
            <div>
              <span>T</span>
              <strong>{currentT.toFixed(2)}</strong>
            </div>
            <div>
              <span>
                V<sub>0</sub>T
              </span>
              <strong>{growthPerBirth.toFixed(3)}</strong>
            </div>
            <div>
              <span>ポテンシャル</span>
              <strong>Σ 1/d^4</strong>
            </div>
            <div>
              <span>表示間隔</span>
              <strong>{settings.waitMs}ms</strong>
            </div>
            <div>
              <span>黄金角</span>
              <strong>{GOLDEN_ANGLE.toFixed(5)}°</strong>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
