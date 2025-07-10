const BITS_PER_PASS = 8;
const BUCKETS = 1 << BITS_PER_PASS; // 256
const MASK = BUCKETS - 1;

/** LSD Radix Sort for 32-bit unsigned ints */
function radixSort32(arr: Uint32Array): Uint32Array {
  const n = arr.length;
  let input = arr.slice();
  let output = new Uint32Array(n);

  for (let shift = 0; shift < 32; shift += BITS_PER_PASS) {
    const count = new Uint32Array(BUCKETS);
    for (let i = 0; i < n; i++) {
      count[(input[i] >>> shift) & MASK]++;
    }
    let sum = 0;
    for (let i = 0; i < BUCKETS; i++) {
      const c = count[i];
      count[i] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const key = input[i];
      const bucket = (key >>> shift) & MASK;
      output[count[bucket]++] = key;
    }
    [input, output] = [output, input];
  }
  return input;
}

/** Stable LSD Radix Sort that also reorders a parallel array of values */
function radixSort32WithValues<T>(
  keys: Uint32Array,
  values: T[]
): { keys: Uint32Array; values: T[] } {
  const n = keys.length;
  let inKeys = keys.slice();
  let outKeys = new Uint32Array(n);
  let inVals = values.slice();
  let outVals = new Array<T>(n);

  for (let shift = 0; shift < 32; shift += BITS_PER_PASS) {
    const count = new Uint32Array(BUCKETS);
    for (let i = 0; i < n; i++) {
      count[(inKeys[i] >>> shift) & MASK]++;
    }
    let sum = 0;
    for (let i = 0; i < BUCKETS; i++) {
      const c = count[i];
      count[i] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const key = inKeys[i];
      const bucket = (key >>> shift) & MASK;
      const pos = count[bucket]++;
      outKeys[pos] = key;
      outVals[pos] = inVals[i];
    }
    [inKeys, outKeys] = [outKeys, inKeys];
    [inVals, outVals] = [outVals, inVals];
  }
  return { keys: inKeys, values: inVals };
}

/** Encode floats into sortable uints */
function float32ToUint32Sortable(arr: Float32Array): Uint32Array {
  const n = arr.length;
  const result = new Uint32Array(n);
  const buf = new ArrayBuffer(4);
  const dv = new DataView(buf);
  for (let i = 0; i < n; i++) {
    dv.setFloat32(0, arr[i], true); // little-endian
    let bits = dv.getUint32(0, true);
    if (bits & 0x80000000) {
      bits = ~bits;
    } else {
      bits ^= 0x80000000;
    }
    result[i] = bits;
  }
  return result;
}

/**
 * Sort Float32Array and reorder associated keys via radix sort subroutine.
 * Returns sorted floats and re-ordered keys.
 */
export function radixSortFloat32WithKeys<T>(
  floatVals: Float32Array,
  keys: T[]
): { sortedValues: Float32Array; sortedKeys: T[] } {
  if (floatVals.length !== keys.length) {
    throw new Error('floatVals and keys must be same length');
  }
  // a) encode
  const encoded = float32ToUint32Sortable(floatVals);
  // b) sort encoded ints + reorder keys
  const { keys: sortedEnc, values: sortedKeys } =
    radixSort32WithValues(encoded, keys);
  // c) decode sorted floats
  const n = sortedEnc.length;
  const sortedValues = new Float32Array(n);
  const buf = new ArrayBuffer(4);
  const dv = new DataView(buf);
  for (let i = 0; i < n; i++) {
    let bits = sortedEnc[i];
    if (bits & 0x80000000) {
      bits ^= 0x80000000;
    } else {
      bits = ~bits;
    }
    dv.setUint32(0, bits, true);
    sortedValues[i] = dv.getFloat32(0, true);
  }
  return { sortedValues, sortedKeys };
}

function testFloatSort() {
  const size = 16;
  const floats = new Float32Array(size);
  const keys = new Array<string>(size);
  for (let i = 0; i < size; i++) {
    floats[i] = (Math.random() - 0.5) * 100;
    keys[i] = `item${i}`;
  }
  const arrayBefore = Array.from(floats); // number[]
  const pairsBefore: Array<{ key: string; value: number }> = arrayBefore.map(
    (v, i) => ({ key: keys[i], value: v })
  );
  console.log('Before:');
  console.table(pairsBefore);

  const { sortedValues, sortedKeys } = radixSortFloat32WithKeys(floats, keys);

  const arrayAfter = Array.from(sortedValues);
  const pairsAfter: Array<{ key: string; value: number }> = arrayAfter.map(
    (v, i) => ({ key: sortedKeys[i], value: v })
  );
  console.log('After:');
  console.table(pairsAfter);
}

// testFloatSort();
