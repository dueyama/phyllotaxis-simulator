import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const TAU = Math.PI * 2;
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const GOLDEN_ANGLE = 360 * (1 - 1 / GOLDEN_RATIO);
const FIXED_ANGLE_BIRTH_RADIUS = 0.025;
const MODEL_BIRTH_RADIUS = 0.06;
const MODEL_TOTAL_BIRTHS = 900;
const FIXED_ANGLE_TOTAL_BIRTHS = 560;
const FIXED_ANGLE_G =
  (1 / FIXED_ANGLE_BIRTH_RADIUS - 1) / (FIXED_ANGLE_TOTAL_BIRTHS - 1);
const SPIRAL_LINE_START_RADIUS = 0.075;
const POTENTIAL_SAMPLE_COUNT = 1440;
const POTENTIAL_MIN_PARTICLES = 96;
const POTENTIAL_MAX_PARTICLES = 420;
const POTENTIAL_RADIUS_WINDOW = 14;
const POTENTIAL_MIN_DISTANCE = 0.02;
const POTENTIAL_MAX_TERM = 1 / POTENTIAL_MIN_DISTANCE ** 3;
const ANGLE_PRESETS = [
  { label: "黄金角", value: GOLDEN_ANGLE },
  { label: "137.45°", value: 137.45 },
  { label: "137.50°", value: 137.5 },
  { label: "137.55°", value: 137.55 },
  { label: "137.60°", value: 137.6 },
  { label: "138.00°", value: 138 },
];
const FALLBACK_PARASTICHIES = {
  clockwise: { step: 1 },
  counterClockwise: { step: 2 },
};

function fibonacci(count) {
  const seq = [1, 1];
  while (seq.length < count) {
    seq.push(seq.at(-1) + seq.at(-2));
  }
  return seq.slice(0, count);
}

function mod1(value) {
  return ((value % 1) + 1) % 1;
}

function signedTurnFraction(step, angleDegrees) {
  const fraction = mod1((step * angleDegrees) / 360);
  return fraction > 0.5 ? fraction - 1 : fraction;
}

function signedAngleDifference(next, previous) {
  return Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
}

function generateVogelPoints(count, angleDegrees) {
  return Array.from({ length: count }, (_, index) => {
    const radius = Math.sqrt((index + 0.55) / count);
    const theta = ((angleDegrees * index - 90) * Math.PI) / 180;
    return {
      index,
      theta,
      radius,
      x: Math.cos(theta) * radius,
      y: Math.sin(theta) * radius,
    };
  });
}

function generateFixedAngleSimulation({ count, angleDegrees, g }) {
  const angles = [];
  const cumulativeGrowth = [];
  for (let index = 0; index < count; index += 1) {
    angles.push(((angleDegrees * index - 90) * Math.PI) / 180);
    cumulativeGrowth.push(index * g);
  }

  return {
    angles,
    cumulativeGrowth,
    angleDegrees,
    birthRadius: FIXED_ANGLE_BIRTH_RADIUS,
    rawDivergences: Array(Math.max(0, count - 1)).fill((angleDegrees * Math.PI) / 180),
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianOrFallback(values, fallback) {
  const value = median(values);
  return value || fallback;
}

function detectParastichies(points, angleDegrees) {
  const count = points.length;
  const maxStep = Math.min(89, Math.max(8, Math.floor(count / 2)));
  const candidates = [];

  for (let step = 1; step <= maxStep; step += 1) {
    const distances = [];
    for (let index = 0; index < count - step; index += 1) {
      const a = points[index];
      const b = points[index + step];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      distances.push(Math.hypot(dx, dy));
    }

    candidates.push({
      step,
      turn: signedTurnFraction(step, angleDegrees),
      score: median(distances),
    });
  }

  const positive = candidates
    .filter((candidate) => candidate.turn > 0.001)
    .sort((a, b) => a.score - b.score)[0];
  const negative = candidates
    .filter((candidate) => candidate.turn < -0.001)
    .sort((a, b) => a.score - b.score)[0];

  return {
    clockwise: positive ?? candidates[0],
    counterClockwise: negative ?? candidates[1] ?? candidates[0],
  };
}

function buildSpiralPaths(points, step) {
  const paths = [];
  for (let start = 0; start < step; start += 1) {
    const path = [];
    for (let index = start; index < points.length; index += step) {
      path.push(points[index]);
    }
    if (path.length >= 3) paths.push(path);
  }
  return paths;
}

function buildNearestOutwardPaths(points, direction) {
  const inferredBirthRadius =
    points.length > 0
      ? Math.max(0.001, Math.min(...points.map((point) => point.radius)))
      : MODEL_BIRTH_RADIUS;
  const rawLinks = [];

  for (const point of points) {
    let nearest = null;
    const pointOrder = point.originalIndex ?? point.index;

    for (const candidate of points) {
      const candidateOrder = candidate.originalIndex ?? candidate.index;
      const birthGap = Math.abs(candidateOrder - pointOrder);
      if (birthGap < 1) continue;

      const radialGap = candidate.radius - point.radius;
      if (radialGap <= Math.max(0.0015, point.radius * 0.012)) continue;

      const delta = signedAngleDifference(candidate.theta, point.theta);
      if (direction === "right" && delta >= -0.0001) continue;
      if (direction === "left" && delta <= 0.0001) continue;
      if (Math.abs(delta) > 1.05) continue;

      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      const relDistance = distance / Math.max(point.radius, inferredBirthRadius * 1.5);
      const radiusRatio = candidate.radius / Math.max(point.radius, inferredBirthRadius);
      if (radiusRatio > 2.2) continue;

      const score = distance + radialGap * 0.42 + Math.abs(delta) * 0.08;
      if (!nearest || score < nearest.score) {
        nearest = {
          from: point,
          to: candidate,
          birthGap,
          delta,
          distance,
          relDistance,
          radiusRatio,
          score,
        };
      }
    }

    if (nearest) {
      rawLinks.push(nearest);
    }
  }

  if (!rawLinks.length) return { count: 0, paths: [] };

  const interiorLinks = rawLinks.filter(
    (link) =>
      link.from.radius > inferredBirthRadius * 2.4 &&
      link.from.radius < 0.78 &&
      link.to.radius < 0.94,
  );
  const stableLinks = interiorLinks.length >= 6 ? interiorLinks : rawLinks;
  const gapStats = new Map();
  for (const link of stableLinks) {
    const stat = gapStats.get(link.birthGap) ?? {
      count: 0,
      distance: 0,
      relDistance: 0,
      radiusRatio: 0,
    };
    stat.count += 1;
    stat.distance += link.distance;
    stat.relDistance += link.relDistance;
    stat.radiusRatio += link.radiusRatio;
    gapStats.set(link.birthGap, stat);
  }

  const dominant = [...gapStats.entries()]
    .map(([gap, stat]) => ({
      gap,
      count: stat.count,
      averageDistance: stat.distance / stat.count,
      averageRelDistance: stat.relDistance / stat.count,
      averageRadiusRatio: stat.radiusRatio / stat.count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.averageDistance - b.averageDistance ||
        a.gap - b.gap,
    )[0];
  if (!dominant) return { count: 0, paths: [] };

  const orderedPoints = [...points].sort((a, b) => a.radius - b.radius);
  const innerOrder = orderedPoints[0]?.originalIndex ?? orderedPoints[0]?.index ?? 0;
  const outerOrder =
    orderedPoints[orderedPoints.length - 1]?.originalIndex ??
    orderedPoints[orderedPoints.length - 1]?.index ??
    innerOrder;
  const outwardOrderDirection = outerOrder > innerOrder ? 1 : -1;
  const pointByOrder = new Map(
    points.map((point) => [point.originalIndex ?? point.index, point]),
  );
  const maxRelDistance = Math.max(dominant.averageRelDistance * 2.1, 0.72);
  const maxRadiusRatio = Math.max(dominant.averageRadiusRatio * 1.65, 1.65);

  const paths = [];
  for (const point of orderedPoints) {
    if (point.radius < SPIRAL_LINE_START_RADIUS) continue;

    const currentOrder = point.originalIndex ?? point.index;
    const next = pointByOrder.get(currentOrder + outwardOrderDirection * dominant.gap);
    if (!next || next.radius <= point.radius || next.radius >= 0.985) continue;

    const delta = signedAngleDifference(next.theta, point.theta);
    if (direction === "right" && delta >= -0.0001) continue;
    if (direction === "left" && delta <= 0.0001) continue;
    if (Math.abs(delta) > 1.05) continue;

    const distance = Math.hypot(next.x - point.x, next.y - point.y);
    const relDistance = distance / Math.max(point.radius, inferredBirthRadius * 1.5);
    const radiusRatio = next.radius / Math.max(point.radius, inferredBirthRadius);
    if (relDistance > maxRelDistance || radiusRatio > maxRadiusRatio) continue;

    paths.push([point, next]);
  }

  return {
    count: dominant.gap,
    paths,
  };
}

function analyzeNearestOutwardSpirals(points) {
  const right = buildNearestOutwardPaths(points, "right");
  const left = buildNearestOutwardPaths(points, "left");

  return {
    clockwise: {
      count: right.count,
      paths: right.paths,
    },
    counterClockwise: {
      count: left.count,
      paths: left.paths,
    },
  };
}

function spiralCount(spiral) {
  return spiral?.count ?? spiral?.step ?? 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function useParticleMotion(finalPoints, motionKey, durationMs = 4200) {
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!finalPoints.length) {
      setProgress(1);
      return undefined;
    }

    let frame = 0;
    let start = 0;
    setProgress(0);

    const tick = (time) => {
      if (!start) start = time;
      const nextProgress = clamp((time - start) / durationMs, 0, 1);
      setProgress(nextProgress);
      if (nextProgress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [finalPoints, motionKey, durationMs]);

  const animatedPoints = useMemo(() => {
    if (!finalPoints.length) return [];
    const maxIndex = Math.max(1, finalPoints.length - 1);

    return finalPoints
      .map((point) => {
        const birth = (point.index / maxIndex) * 0.72;
        const localProgress = clamp((progress - birth) / (1 - birth), 0, 1);
        if (localProgress <= 0) return null;

        const eased = easeOutCubic(localProgress);
        const radius = Math.max(0.018, point.radius * eased);
        return {
          ...point,
          radius,
          x: Math.cos(point.theta) * radius,
          y: Math.sin(point.theta) * radius,
        };
      })
      .filter(Boolean);
  }, [finalPoints, progress]);

  return {
    points: animatedPoints,
    progress,
    isMoving: progress < 1,
    showLines: progress >= 1,
  };
}

function useSequentialPlacement(finalPoints, motionKey, durationMs = 5200) {
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!finalPoints.length) {
      setProgress(1);
      return undefined;
    }

    let frame = 0;
    let start = 0;
    setProgress(0);

    const tick = (time) => {
      if (!start) start = time;
      const nextProgress = clamp((time - start) / durationMs, 0, 1);
      setProgress(nextProgress);
      if (nextProgress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [finalPoints, motionKey, durationMs]);

  const visibleCount = Math.max(
    1,
    Math.min(finalPoints.length, Math.ceil(progress * finalPoints.length)),
  );

  return {
    points: finalPoints.slice(0, visibleCount),
    progress,
    isMoving: progress < 1,
    showLines: progress >= 1,
  };
}

function simulateDouady({ count, targetG, decreasing }) {
  let activeParticles = [
    {
      index: 0,
      theta: -Math.PI / 2,
      cosTheta: 0,
      sinTheta: -1,
      radius: 1,
      g: targetG,
    },
  ];
  const divergences = [];
  const angles = [-Math.PI / 2];
  const cumulativeGrowth = [0];
  const samples = POTENTIAL_SAMPLE_COUNT;
  const interactionCutoffRadius = 1 / MODEL_BIRTH_RADIUS;
  const sampleTrig = Array.from({ length: samples }, (_, sample) => {
    const theta = (sample / samples) * TAU;
    return {
      theta,
      cosTheta: Math.cos(theta),
      sinTheta: Math.sin(theta),
    };
  });
  const potentialEnergy = (cosTheta, sinTheta, particles) => {
    let energy = 0;
    let compensation = 0;

    for (const particle of particles) {
      const angularAlignment =
        cosTheta * particle.cosTheta + sinTheta * particle.sinTheta;
      const distanceSquared =
        1 +
        particle.radius * particle.radius -
        2 * particle.radius * angularAlignment;
      const distance = Math.sqrt(Math.max(distanceSquared, 0));
      const term =
        distance <= POTENTIAL_MIN_DISTANCE
          ? POTENTIAL_MAX_TERM
          : 1 / (distance * distance * distance);
      const corrected = term - compensation;
      const nextEnergy = energy + corrected;
      compensation = (nextEnergy - energy) - corrected;
      energy = nextEnergy;
    }

    return energy;
  };
  const potentialEnergyAt = (theta, particles) =>
    potentialEnergy(Math.cos(theta), Math.sin(theta), particles);
  const refineMinimum = (centerTheta, particles) => {
    let left = centerTheta - TAU / samples;
    let right = centerTheta + TAU / samples;
    const inversePhi = (Math.sqrt(5) - 1) / 2;
    let x1 = right - (right - left) * inversePhi;
    let x2 = left + (right - left) * inversePhi;
    let e1 = potentialEnergyAt(x1, particles);
    let e2 = potentialEnergyAt(x2, particles);

    for (let iteration = 0; iteration < 22; iteration += 1) {
      if (e1 < e2) {
        right = x2;
        x2 = x1;
        e2 = e1;
        x1 = right - (right - left) * inversePhi;
        e1 = potentialEnergyAt(x1, particles);
      } else {
        left = x1;
        x1 = x2;
        e1 = e2;
        x2 = left + (right - left) * inversePhi;
        e2 = potentialEnergyAt(x2, particles);
      }
    }

    const theta = (left + right) / 2;
    return {
      theta,
      energy: potentialEnergyAt(theta, particles),
    };
  };

  for (let index = 1; index < count; index += 1) {
    const progress = index / Math.max(1, count - 1);
    const currentG = decreasing
      ? 1.05 * Math.pow(targetG / 1.05, progress)
      : targetG;
    for (const particle of activeParticles) {
      particle.radius += currentG;
    }
    activeParticles = activeParticles.filter(
      (particle) => particle.radius <= interactionCutoffRadius,
    );
    cumulativeGrowth.push(cumulativeGrowth[index - 1] + currentG);

    const potentialParticleCount = clamp(
      Math.ceil(POTENTIAL_RADIUS_WINDOW / Math.max(currentG, 0.005)),
      POTENTIAL_MIN_PARTICLES,
      POTENTIAL_MAX_PARTICLES,
    );
    const recent = activeParticles.slice(-potentialParticleCount);
    let bestTheta = 0;
    let bestEnergy = Number.POSITIVE_INFINITY;
    const sampleEnergies = [];

    for (let sample = 0; sample < samples; sample += 1) {
      const { theta, cosTheta, sinTheta } = sampleTrig[sample];
      const energy = potentialEnergy(cosTheta, sinTheta, recent);
      sampleEnergies.push(energy);
      if (energy < bestEnergy) {
        bestEnergy = energy;
        bestTheta = theta;
      }
    }

    const localMinima = [];
    for (let sample = 0; sample < samples; sample += 1) {
      const previous = sampleEnergies[(sample - 1 + samples) % samples];
      const current = sampleEnergies[sample];
      const next = sampleEnergies[(sample + 1) % samples];
      if (current <= previous && current <= next) {
        localMinima.push({
          theta: sampleTrig[sample].theta,
          energy: current,
        });
      }
    }

    const minimaToRefine = (localMinima.length ? localMinima : [{ theta: bestTheta, energy: bestEnergy }])
      .sort((a, b) => a.energy - b.energy)
      .slice(0, 8);
    for (const minimum of minimaToRefine) {
      const refined = refineMinimum(minimum.theta, recent);
      if (refined.energy < bestEnergy) {
        bestEnergy = refined.energy;
        bestTheta = refined.theta;
      }
    }

    bestTheta = ((bestTheta % TAU) + TAU) % TAU;
    const previousTheta = angles[angles.length - 1];
    divergences.push(Math.abs(signedAngleDifference(bestTheta, previousTheta)));
    activeParticles.push({
      index,
      theta: bestTheta,
      cosTheta: Math.cos(bestTheta),
      sinTheta: Math.sin(bestTheta),
      radius: 1,
      g: currentG,
    });
    angles.push(bestTheta);
  }

  const recentDivergence = median(divergences.slice(-24)) || Math.PI;
  const angleDegrees = Math.min(180, (recentDivergence * 180) / Math.PI);
  const displayAngle = angleDegrees > 180 ? 360 - angleDegrees : angleDegrees;

  return {
    angles,
    cumulativeGrowth,
    angleDegrees: displayAngle,
    birthRadius: MODEL_BIRTH_RADIUS,
    rawDivergences: divergences,
  };
}

function pointsForGrowthStep(simulation, step, birthRadius = MODEL_BIRTH_RADIUS) {
  if (!simulation) return [];
  const currentStep = clamp(Math.floor(step), 0, simulation.angles.length - 1);
  const currentGrowth = simulation.cumulativeGrowth[currentStep] ?? 0;
  const points = [];

  for (let index = 0; index <= currentStep; index += 1) {
    const growthSinceBirth = currentGrowth - simulation.cumulativeGrowth[index];
    const radius = birthRadius * (1 + growthSinceBirth);
    if (radius <= 1) {
      const theta = simulation.angles[index];
      points.push({
        index: points.length,
        originalIndex: index,
        theta,
        radius,
        x: Math.cos(theta) * radius,
        y: Math.sin(theta) * radius,
      });
    }
  }

  return points;
}

function useFixedAngleSimulation(settings) {
  return useMemo(() => generateFixedAngleSimulation(settings), [
    settings.count,
    settings.angleDegrees,
    settings.g,
  ]);
}

function useDouadySimulation(settings) {
  const [simulation, setSimulation] = useState(null);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (runId === 0) return;
    let cancelled = false;
    setSimulation(null);
    const handle = window.setTimeout(() => {
      const next = simulateDouady(settings);
      if (!cancelled) setSimulation(next);
    }, 24);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [settings.count, settings.targetG, settings.decreasing, runId]);

  return {
    simulation,
    run: () => setRunId((value) => value + 1),
  };
}

function useGrowthPlayback(simulation, motionKey, durationMs = 5200) {
  const [progress, setProgress] = useState(1);
  const [stopped, setStopped] = useState(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!simulation) {
      setProgress(1);
      setStopped(false);
      stoppedRef.current = false;
      return undefined;
    }

    const start = performance.now();
    setProgress(0);
    setStopped(false);
    stoppedRef.current = false;

    let interval = 0;
    const tick = () => {
      if (stoppedRef.current) return;
      const time = performance.now();
      const nextProgress = clamp((time - start) / durationMs, 0, 1);
      setProgress(nextProgress);
      if (nextProgress >= 1) {
        window.clearInterval(interval);
      }
    };

    interval = window.setInterval(tick, 33);
    tick();
    return () => window.clearInterval(interval);
  }, [simulation, motionKey, durationMs]);

  const step = simulation ? progress * (simulation.angles.length - 1) : 0;
  const points = pointsForGrowthStep(simulation, step, simulation?.birthRadius);

  return {
    points,
    progress,
    isMoving: progress < 1 && !stopped,
    isComplete: progress >= 1,
    showLines: stopped,
    canDraw: Boolean(simulation) && progress >= 1 && !stopped,
    drawSpirals: () => {
      stoppedRef.current = true;
      setStopped(true);
    },
  };
}

function svgPoint(point, size = 520, margin = 34) {
  const scale = size / 2 - margin;
  return {
    x: size / 2 + point.x * scale,
    y: size / 2 + point.y * scale,
  };
}

function SpiralDiagram({
  points,
  parastichies,
  size = 520,
  showBoth = true,
  showLines = true,
  birthRingScale = null,
  emphasizeBirthRing = false,
}) {
  const clockwisePaths =
    parastichies.clockwise.paths ??
    buildSpiralPaths(points, parastichies.clockwise.step);
  const counterPaths =
    parastichies.counterClockwise.paths ??
    buildSpiralPaths(points, parastichies.counterClockwise.step);

  const renderPath = (path) =>
    path
      .map((point, index) => {
        const projected = svgPoint(point, size);
        return `${index === 0 ? "M" : "L"} ${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`;
      })
      .join(" ");

  return (
    <svg className="phyllo-svg" viewBox={`0 0 ${size} ${size}`} role="img">
      <circle className="disc" cx={size / 2} cy={size / 2} r={size / 2 - 24} />
      {showLines && (
        <g>
          <g className="spiral-lines clockwise-lines">
            {clockwisePaths.map((path, index) => (
              <path key={`cw-${index}`} d={renderPath(path)} />
            ))}
          </g>
          {showBoth && (
            <g className="spiral-lines counter-lines">
              {counterPaths.map((path, index) => (
                <path key={`ccw-${index}`} d={renderPath(path)} />
              ))}
            </g>
          )}
        </g>
      )}
      <g>
        {points.map((point) => {
          const projected = svgPoint(point, size);
          const radius = point.radius < SPIRAL_LINE_START_RADIUS ? 2.35 : 3.15;
          return (
            <circle
              key={point.index}
              className="seed-dot"
              cx={projected.x}
              cy={projected.y}
              r={radius}
            />
          );
        })}
      </g>
      {birthRingScale !== null && (
        <circle
          className={emphasizeBirthRing ? "birth-ring birth-ring-emphasis" : "birth-ring"}
          cx={size / 2}
          cy={size / 2}
          r={(size / 2 - 34) * birthRingScale}
        />
      )}
    </svg>
  );
}

function LessonHeader() {
  return (
    <header className="hero">
      <nav className="topbar">
        <span className="brand">Phyllotaxis Learning</span>
        <a href="#spirals">螺旋を数える</a>
        <a href="#model">モデル</a>
        <a href="#bifurcation">分岐図</a>
      </nav>
      <div className="hero-grid">
        <div className="hero-copy">
          <h1>葉序問題を、数列から自己組織化モデルまで順に学ぶ。</h1>
          <p>
            フィボナッチ数列、黄金比、黄金角、植物に現れる左右の螺旋数、そして
            Douady-Couder 型の反発最小化シミュレーションを、すべてコードで再構成した教材です。
          </p>
        </div>
        <GoldenPreview />
      </div>
    </header>
  );
}

function GoldenPreview() {
  const points = useMemo(() => generateVogelPoints(180, GOLDEN_ANGLE), []);
  const parastichies = useMemo(() => analyzeNearestOutwardSpirals(points), [points]);
  return (
    <div className="preview-panel">
      <SpiralDiagram
        points={points}
        parastichies={parastichies}
        size={430}
        birthRingScale={FIXED_ANGLE_BIRTH_RADIUS}
        emphasizeBirthRing
      />
      <div className="preview-caption">
        <span>黄金角 {GOLDEN_ANGLE.toFixed(2)}°</span>
        <strong>
          {spiralCount(parastichies.clockwise)} /{" "}
          {spiralCount(parastichies.counterClockwise)}
        </strong>
      </div>
    </div>
  );
}

function FibonacciSection() {
  const seq = fibonacci(12);
  const ratios = seq.slice(1).map((value, index) => value / seq[index]);

  return (
    <section className="section two-column">
      <div>
        <p className="section-number">01</p>
        <h2>フィボナッチ数列と黄金比</h2>
        <p>
          フィボナッチ数列は、直前の2項を足して次の項を作る数列です。
          隣り合う項の比は、項が進むにつれて黄金比に近づきます。
        </p>
        <div className="formula">F(n+1) = F(n) + F(n-1)</div>
      </div>
      <div className="number-board">
        <div className="sequence">
          {seq.map((value, index) => (
            <span key={`${value}-${index}`}>{value}</span>
          ))}
        </div>
        <div className="ratio-list">
          {ratios.slice(3, 10).map((ratio, index) => (
            <div key={index}>
              <span>{seq[index + 4]} / {seq[index + 3]}</span>
              <strong>{ratio.toFixed(5)}</strong>
            </div>
          ))}
        </div>
        <div className="golden-value">黄金比 φ = {GOLDEN_RATIO.toFixed(5)}</div>
      </div>
    </section>
  );
}

function SpiralCounterSection() {
  const [angle, setAngle] = useState(GOLDEN_ANGLE);
  const [replayId, setReplayId] = useState(0);
  const simulation = useFixedAngleSimulation({
    count: FIXED_ANGLE_TOTAL_BIRTHS,
    angleDegrees: angle,
    g: FIXED_ANGLE_G,
  });
  const playback = useGrowthPlayback(
    simulation,
    `${angle}-${FIXED_ANGLE_TOTAL_BIRTHS}-${replayId}`,
  );
  const finalPoints = useMemo(
    () =>
      pointsForGrowthStep(
        simulation,
        simulation.angles.length - 1,
        FIXED_ANGLE_BIRTH_RADIUS,
      ),
    [simulation],
  );
  const parastichies = useMemo(
    () => analyzeNearestOutwardSpirals(finalPoints),
    [finalPoints],
  );
  const canDrawSpirals =
    !playback.isMoving &&
    !playback.showLines &&
    spiralCount(parastichies.clockwise) > 0 &&
    spiralCount(parastichies.counterClockwise) > 0;
  const showSpirals =
    playback.showLines &&
    spiralCount(parastichies.clockwise) > 0 &&
    spiralCount(parastichies.counterClockwise) > 0;

  return (
    <section id="spirals" className="section lab-section">
      <div className="section-intro">
        <p className="section-number">02</p>
        <h2>粒子をつなぎ、右巻き・左巻きの螺旋を数える</h2>
        <p>
          各粒子を、より外側にある右向き・左向きの最近傍へ別々に結びます。
          局所的な螺旋の連続性が崩れたところで接続を止めると、黄金角付近ではフィボナッチ数の組が現れます。
        </p>
      </div>
      <div className="lab-grid">
        <div className="visual-card">
          <div className="animation-stage">
            <SpiralDiagram
              points={playback.points}
              parastichies={parastichies}
              showLines={showSpirals}
              birthRingScale={FIXED_ANGLE_BIRTH_RADIUS}
              emphasizeBirthRing
            />
            <div className="animation-status">
              {showSpirals
                ? "停止後の点群で螺旋を接続"
                : playback.isMoving
                  ? "一つずつ発射して放射方向へ移動中"
                  : "移動完了: ボタンで螺旋を描く"}
            </div>
          </div>
        </div>
        <div className="controls-card">
          <div className="metric-pair">
            <div>
              <span>右巻き螺旋</span>
              <strong>{spiralCount(parastichies.clockwise)}</strong>
            </div>
            <div>
              <span>左巻き螺旋</span>
              <strong>{spiralCount(parastichies.counterClockwise)}</strong>
            </div>
          </div>
          <label>
            回転角
            <input
              type="range"
              min="90"
              max="180"
              step="0.001"
              value={angle}
              onChange={(event) => setAngle(Number(event.target.value))}
            />
            <output>{angle.toFixed(3)}°</output>
          </label>
          <div className="button-row">
            {ANGLE_PRESETS.map((preset) => (
              <button key={preset.label} onClick={() => setAngle(preset.value)}>
                {preset.label}
              </button>
            ))}
            <button onClick={() => setReplayId((value) => value + 1)}>再生</button>
            <button
              className="secondary-button"
              disabled={!canDrawSpirals}
              onClick={playback.drawSpirals}
            >
              停止後に螺旋を描く
            </button>
          </div>
          <p className="note">
            各粒子は出生リングから一つずつ発射され、同じ角度差を保って放射方向へ移動します。
            黄金角は {GOLDEN_ANGLE.toFixed(5)}° です。
            そこからわずかに外すだけで螺旋数と密度の見え方が変わります。
          </p>
        </div>
      </div>
    </section>
  );
}

function ModelSection() {
  const [targetG, setTargetG] = useState(0.04);
  const [decreasing, setDecreasing] = useState(false);
  const { simulation, run } = useDouadySimulation({
    count: MODEL_TOTAL_BIRTHS,
    targetG,
    decreasing,
  });
  const playback = useGrowthPlayback(
    simulation,
    simulation ? `${simulation.angleDegrees}-${simulation.angles.length}` : "empty",
  );
  const finalPoints = useMemo(
    () =>
      simulation
        ? pointsForGrowthStep(
            simulation,
            simulation.angles.length - 1,
            MODEL_BIRTH_RADIUS,
          )
        : [],
    [simulation],
  );
  const finalParastichies = useMemo(
    () =>
      simulation && finalPoints.length >= 12
        ? analyzeNearestOutwardSpirals(finalPoints)
        : null,
    [finalPoints, simulation],
  );
  const parastichies = finalParastichies;
  const visualParastichies = parastichies ?? FALLBACK_PARASTICHIES;
  const hasDrawableSpirals =
    Boolean(parastichies) &&
    spiralCount(parastichies.clockwise) > 0 &&
    spiralCount(parastichies.counterClockwise) > 0;
  const canDrawVisibleSpirals =
    !playback.isMoving && !playback.showLines && hasDrawableSpirals;
  const shouldShowSpiralLines = playback.showLines && hasDrawableSpirals;
  const modelStatus = shouldShowSpiralLines
    ? "停止後の点群で螺旋を接続"
    : playback.isMoving
      ? "リング上に生まれ外へ移動中"
      : hasDrawableSpirals
        ? "移動完了: ボタンで螺旋を描く"
        : "Gが大きい時は古い粒子がすぐ外へ出ます";

  return (
    <section id="model" className="section model-section">
      <div className="section-intro">
        <p className="section-number">03</p>
        <h2>Douady-Couder 型の反発最小化シミュレーション</h2>
        <p>
          新しい原基は中心近くの円周上に生まれ、既存原基からの反発ポテンシャルが最小になる角度を選びます。
          通常は出生間隔 T を固定し、既存原基は成長に伴って外向きへ運ばれます。
        </p>
      </div>
      <div className="model-grid">
        <div className="visual-card">
          {simulation ? (
            <div className="animation-stage">
              <SpiralDiagram
                points={playback.points}
                parastichies={visualParastichies}
                showLines={shouldShowSpiralLines}
                birthRingScale={MODEL_BIRTH_RADIUS}
                emphasizeBirthRing
              />
              <div className="animation-status">{modelStatus}</div>
            </div>
          ) : (
            <div className="simulation-loading">
              <span />
              <strong>モデルを計算して再生</strong>
            </div>
          )}
        </div>
        <div className="controls-card">
          <div className="equation-block">
            <span>制御パラメータ</span>
            <strong>G = V₀T / R₀</strong>
            <small>この教材では V₀/R₀ を固定し、T で G を変えます。</small>
          </div>
          <div className="metric-pair">
            <div>
              <span>目標G</span>
              <strong>{targetG.toFixed(2)}</strong>
            </div>
            <div>
              <span>推定発散角</span>
              <strong>{simulation ? `${simulation.angleDegrees.toFixed(2)}°` : "..."}</strong>
            </div>
            <div>
              <span>螺旋数</span>
              <strong>
                {parastichies
                  ? `${spiralCount(parastichies.clockwise)} / ${spiralCount(
                      parastichies.counterClockwise,
                    )}`
                  : simulation
                    ? "未確定"
                    : "..."}
              </strong>
            </div>
          </div>
          <label>
            出生間隔 T
            <input
              type="range"
              min="0.01"
              max="0.8"
              step="0.01"
              value={targetG}
              onChange={(event) => setTargetG(Number(event.target.value))}
            />
            <output>目標G={targetG.toFixed(2)}</output>
          </label>
          <div className="button-row">
            <button onClick={() => setTargetG(0.04)}>G 0.04</button>
            <button onClick={() => setTargetG(0.08)}>G 0.08</button>
            <button onClick={() => setTargetG(0.3)}>G 0.30</button>
            <button onClick={() => setTargetG(0.8)}>G 0.80</button>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={decreasing}
              onChange={(event) => setDecreasing(event.target.checked)}
            />
            <span>T を徐々に短くする（分岐図用）</span>
          </label>
          <div className="button-row model-actions">
            <button onClick={run}>モデルを計算して再生</button>
            <button
              className="secondary-button"
              disabled={!canDrawVisibleSpirals}
              onClick={playback.drawSpirals}
            >
              停止後に螺旋を描く
            </button>
          </div>
          <p className="note">
            ここでは反発エネルギーを 1/d³ とし、各ステップで円周上を探索して最小点へ新粒子を置きます。
            遠方の粒子は出生リング付近の角度選択にほとんど効かないため、相互作用対象から外します。
            通常は T を固定し、既存粒子は半径方向に等速度で動きます。
            m 回前の粒子の位置は r/R₀ = 1 + mG です。
            G が大きいほど出生間隔あたりの外向き移動が大きく、見える粒子は少なくなります。
            分岐を見せる時だけ T を短くし、出生ごとの移流量 G を下げます。
          </p>
        </div>
      </div>
    </section>
  );
}

function BifurcationSection() {
  const families = [
    { pair: [1, 1], g: 0.92, angle: 180 },
    { pair: [1, 2], g: 0.63, angle: 150 },
    { pair: [2, 3], g: 0.42, angle: 144 },
    { pair: [3, 5], g: 0.25, angle: 139 },
    { pair: [5, 8], g: 0.15, angle: 137.9 },
    { pair: [8, 13], g: 0.085, angle: 137.6 },
    { pair: [13, 21], g: 0.045, angle: 137.51 },
  ];

  const width = 760;
  const height = 360;
  const margin = { left: 54, right: 28, top: 22, bottom: 44 };
  const x = (g) =>
    margin.left + (1 - g / 1.05) * (width - margin.left - margin.right);
  const y = (angle) =>
    margin.top + ((180 - angle) / 95) * (height - margin.top - margin.bottom);

  const path = families
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.g)} ${y(point.angle)}`)
    .join(" ");

  return (
    <section id="bifurcation" className="section">
      <div className="section-intro">
        <p className="section-number">04</p>
        <h2>分岐図は、どの螺旋数が選ばれるかの地図</h2>
        <p>
          V₀/R₀ を固定して T を短くすると、`G = V₀T/R₀` が小さくなります。
          新しい原基はより多くの古い原基の影響を受けます。
          そのたびに周期的な重なりを避け、螺旋数は `(i, j) → (j, i+j)` へ進みます。
        </p>
      </div>
      <div className="bifurcation-card">
        <svg viewBox={`0 0 ${width} ${height}`} className="bifurcation-svg">
          <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} />
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} />
          <text x={margin.left} y={height - 10}>大きい G</text>
          <text x={width - 112} y={height - 10}>小さい G</text>
          <text x={10} y={34}>発散角</text>
          <path className="main-branch" d={path} />
          {families.map((point, index) => (
            <g key={`${point.pair[0]}-${point.pair[1]}`}>
              <circle className="branch-node" cx={x(point.g)} cy={y(point.angle)} r={6} />
              <text className="branch-label" x={x(point.g) + 10} y={y(point.angle) - 10}>
                {point.pair[0]}-{point.pair[1]}
              </text>
              {index > 1 && (
                <path
                  className="side-branch"
                  d={`M ${x(point.g)} ${y(point.angle)} C ${x(point.g) - 16} ${y(point.angle) + 44}, ${x(point.g) - 54} ${y(point.angle) + 64}, ${x(point.g) - 80} ${y(point.angle) + 72}`}
                />
              )}
            </g>
          ))}
        </svg>
        <div className="diagram-legend">
          <span>主枝: フィボナッチ系列へ進む安定な遷移</span>
          <span>側枝: 初期条件によって現れる別系列</span>
        </div>
      </div>
    </section>
  );
}

function PracticeSection() {
  return (
    <section className="section practice-section">
      <p className="section-number">05</p>
      <h2>論文理論を教材として実践するための対応</h2>
      <div className="practice-grid">
        <div>
          <strong>観察</strong>
          <p>ヒマワリや松ぼっくりで左右の螺旋を数えると、隣り合うフィボナッチ数が多く現れる。</p>
        </div>
        <div>
          <strong>幾何</strong>
          <p>一定角度で粒子を打つと、黄金角付近で空間が均一に埋まり、近傍線がフィボナッチ数の螺旋を作る。</p>
        </div>
        <div>
          <strong>物理モデル</strong>
          <p>新粒子は反発が最小になる場所に生まれ、既存粒子は外へ流される。必要な制御量は `G` に集約される。</p>
        </div>
        <div>
          <strong>分岐</strong>
          <p>T を短くして `G = V₀T/R₀` が下がると、周期配置を避ける遷移が起こり、螺旋数は `(i, j) → (j, i+j)` と進む。</p>
        </div>
      </div>
    </section>
  );
}

function App() {
  return (
    <>
      <LessonHeader />
      <main>
        <FibonacciSection />
        <SpiralCounterSection />
        <ModelSection />
        <BifurcationSection />
        <PracticeSection />
      </main>
      <footer>
        <p>
          参考: S. Douady and Y. Couder, “Phyllotaxis as a Physical Self-Organized Growth Process,”
          Physical Review Letters, 1992. 本サイトの図とシミュレーションは公開用に再構成したものです。
        </p>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
