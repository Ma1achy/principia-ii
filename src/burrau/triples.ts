/** Iterator over primitive Pythagorean triples up to m_max. */
export function* primitiveTriples(maxM: number): Generator<{
  m: number; n: number; nu: number; a: number; b: number; c: number;
}> {
  for (let m = 2; m <= maxM; m++) {
    for (let n = 1; n < m; n++) {
      if (gcd(m, n) === 1 && (m - n) % 2 === 1) {
        yield {
          m, n, nu: n / m,
          a: m * m - n * n, b: 2 * m * n, c: m * m + n * n,
        };
      }
    }
  }
}

function gcd(a: number, b: number): number {
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

/** Find the primitive triple closest to a given ν (used to mark the
 *  nearest landmark on the continuous Euclid display). */
export function nearestPrimitiveTriple(
  nu: number, maxM = 32,
): { m: number; n: number; nu: number; distance: number } {
  let best = { m: 2, n: 1, nu: 0.5, distance: Infinity };
  for (const t of primitiveTriples(maxM)) {
    const d = Math.abs(t.nu - nu);
    if (d < best.distance) best = { m: t.m, n: t.n, nu: t.nu, distance: d };
  }
  return best;
}
