/**
 * Generates a CSS clip-path polygon with jagged "torn paper" edges.
 * Deterministic based on seed (story ID) — same card always looks the same.
 */

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function generateTornEdge(seed = 1, jaggedness = 3) {
  const rand = seededRandom(seed * 7919 + 104729);
  const points = [];
  const steps = 16;

  // Top edge (left to right)
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * 100;
    const y = i === 0 || i === steps ? 0 : rand() * jaggedness;
    points.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
  }

  // Right edge (top to bottom)
  for (let i = 1; i < steps; i++) {
    const x = 100 - rand() * jaggedness;
    const y = (i / steps) * 100;
    points.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
  }

  // Bottom edge (right to left)
  for (let i = steps; i >= 0; i--) {
    const x = (i / steps) * 100;
    const y = i === 0 || i === steps ? 100 : 100 - rand() * jaggedness;
    points.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
  }

  // Left edge (bottom to top)
  for (let i = steps - 1; i > 0; i--) {
    const x = rand() * jaggedness;
    const y = (i / steps) * 100;
    points.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
  }

  return `polygon(${points.join(', ')})`;
}
