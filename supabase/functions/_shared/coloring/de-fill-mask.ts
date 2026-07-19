// Pure pixel-mask helpers for solid_black_defill_v1.
// Kept free of any Deno-only imports (no https://…) so Vitest can run it
// under Node. The Deno-side de-fill wrapper re-exports these.

export function computeDeFillKeepMask(
  width: number,
  height: number,
  mask: Uint8Array,
  clusterMask: Uint8Array,
  ringPx: number,
): Uint8Array {
  const total = width * height;
  const dist = new Int32Array(total);
  for (let i = 0; i < total; i++) dist[i] = mask[i] ? -1 : 0;
  const queue: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const up = y > 0 ? idx - width : -1;
      const dn = y < height - 1 ? idx + width : -1;
      const lf = x > 0 ? idx - 1 : -1;
      const rt = x < width - 1 ? idx + 1 : -1;
      const onEdge =
        y === 0 || y === height - 1 || x === 0 || x === width - 1 ||
        (up >= 0 && !mask[up]) || (dn >= 0 && !mask[dn]) ||
        (lf >= 0 && !mask[lf]) || (rt >= 0 && !mask[rt]);
      if (onEdge) { dist[idx] = 1; queue.push(idx); }
    }
  }
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++]!;
    const d = dist[idx];
    if (d >= ringPx + 1) continue;
    const x = idx % width;
    const y = (idx - x) / width;
    const neigh = [
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
    ];
    for (const n of neigh) {
      if (n < 0) continue;
      if (!mask[n]) continue;
      if (dist[n] !== -1) continue;
      dist[n] = d + 1;
      queue.push(n);
    }
  }
  const keep = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (!mask[i]) { keep[i] = 0; continue; }
    if (!clusterMask[i]) { keep[i] = 1; continue; }
    const d = dist[i];
    keep[i] = d > 0 && d <= ringPx ? 1 : 0;
  }
  return keep;
}

export function tagOversizedClusters(
  width: number,
  height: number,
  mask: Uint8Array,
  minSize: number,
): { tag: Uint8Array; count: number; largest: number } {
  const total = width * height;
  const seen = new Uint8Array(total);
  const tag = new Uint8Array(total);
  let largest = 0;
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < total; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const members: number[] = [];
    while (stack.length) {
      const idx = stack.pop()!;
      members.push(idx);
      const x = idx % width;
      const y = (idx - x) / width;
      const neigh = [
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
      ];
      for (const n of neigh) {
        if (n >= 0 && mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    if (members.length > largest) largest = members.length;
    if (members.length >= minSize) {
      count++;
      for (const m of members) tag[m] = 1;
    }
  }
  return { tag, count, largest };
}
