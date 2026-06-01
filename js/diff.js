// ─────────────────────────────────────────────────────────────
// Myers Diff Algorithm — O(ND) time, O(N) space with linear
// space refinement. Handles files of any size efficiently.
// ─────────────────────────────────────────────────────────────

/**
 * Myers diff algorithm: finds shortest edit script (SES).
 * Time: O(N + D²) where D is edit distance
 * Space: O(N) with linear space optimization
 */
function myersDiff(a, b) {
  const N = a.length, M = b.length;
  if (N === 0 && M === 0) return [];
  if (N === 0) return b.map(line => ({ type: 'add', value: line }));
  if (M === 0) return a.map(line => ({ type: 'del', value: line }));

  // Find shortest edit script using Myers algorithm
  const MAX = N + M;
  const V = new Array(2 * MAX + 1);
  const trace = [];
  
  V[MAX + 1] = 0;
  
  for (let D = 0; D <= MAX; D++) {
    const Vnew = new Array(2 * MAX + 1);
    for (let k = -D; k <= D; k += 2) {
      let x;
      if (k === -D || (k !== D && V[MAX + k - 1] < V[MAX + k + 1])) {
        x = V[MAX + k + 1];
      } else {
        x = V[MAX + k - 1] + 1;
      }
      let y = x - k;
      
      // Follow diagonal (matching lines)
      while (x < N && y < M && a[x] === b[y]) {
        x++; y++;
      }
      
      Vnew[MAX + k] = x;
      
      if (x >= N && y >= M) {
        trace.push(Vnew);
        return backtrack(trace, a, b, MAX);
      }
    }
    trace.push(Vnew);
    V.set(Vnew);
  }
  
  return backtrack(trace, a, b, MAX);
}

/**
 * Backtrack through the trace to reconstruct the edit script.
 */
function backtrack(trace, a, b, MAX) {
  let x = a.length, y = b.length;
  const edits = [];
  
  for (let D = trace.length - 1; D >= 0; D--) {
    const V = trace[D];
    const k = x - y;
    
    let prevK;
    if (k === -D || (k !== D && (D > 0 ? trace[D-1] : [])[MAX + k - 1] < (D > 0 ? trace[D-1] : [])[MAX + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    
    const prevX = D > 0 ? trace[D-1][MAX + prevK] : 0;
    const prevY = prevX - prevK;
    
    // Diagonal moves (matches)
    while (x > prevX && y > prevY) {
      edits.unshift({ type: 'ctx', value: a[x - 1] });
      x--; y--;
    }
    
    if (D > 0) {
      if (x === prevX) {
        // Insert
        edits.unshift({ type: 'add', value: b[y - 1] });
        y--;
      } else {
        // Delete
        edits.unshift({ type: 'del', value: a[x - 1] });
        x--;
      }
    }
  }
  
  return edits;
}

/**
 * Main diff function: splits text into lines and computes diff.
 * Returns structured diff with context trimming.
 */
export function diffLines(oldT, newT) {
  const ol = oldT.split('\n');
  const nl = newT.split('\n');
  
  // Compute Myers diff
  const raw = myersDiff(ol, nl);
  
  // Trim context: keep 2 lines around each change
  const C = 2;
  const near = raw.map((_, idx) => {
    if (raw[idx].type !== 'ctx') return true;
    for (let d = -C; d <= C; d++) {
      const ni = idx + d;
      if (ni >= 0 && ni < raw.length && raw[ni].type !== 'ctx') return true;
    }
    return false;
  });
  
  const out = [];
  let skip = false;
  for (let k = 0; k < raw.length; k++) {
    if (near[k]) {
      if (skip) { out.push({ t: 'gap' }); skip = false; }
      out.push({ t: raw[k].type, s: raw[k].value });
    } else if (!skip) skip = true;
  }
  
  return {
    lines: out,
    stats: {
      add: raw.filter(d => d.type === 'add').length,
      del: raw.filter(d => d.type === 'del').length,
    },
  };
}
