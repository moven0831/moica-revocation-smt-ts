/**
 * Poseidon hash over the secq256r1 (P-256) scalar field.
 *
 * Field modulus (scalar order of secp256r1):
 *   p = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
 *
 * Uses @noble/curves to generate Poseidon constants via Grain LFSR
 * and implements the Poseidon permutation.
 *
 * Parameters follow the Hadeshash specification:
 *   - sbox: x^5
 *   - Full rounds: 8
 *   - Partial rounds: 56 (for t=3, i.e. 2-to-1 hash)
 *   - Based on https://eprint.iacr.org/2019/458.pdf Table 2
 */

import { Field } from "@noble/curves/abstract/modular.js";
import {
  grainGenConstants,
  poseidon,
  type PoseidonFn,
} from "@noble/curves/abstract/poseidon.js";

// secq256r1 scalar field order
const SECQ256R1_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// Create the finite field Fp
const Fp = Field(SECQ256R1_ORDER);

// Round numbers from Hadeshash spec (Table 2, 256-bit prime, sbox x^5, 128-bit security)
// Full rounds: 8 (constant for all state sizes)
// Partial rounds per state size t (index = t - 2):
//   t=2: 56, t=3: 57, t=4: 56, t=5: 60, ...
// We primarily need t=3 (for 2-to-1 hash used in SMT)
const ROUNDS_FULL = 8;
const ROUNDS_PARTIAL: Record<number, number> = {
  2: 56,
  3: 57,
  4: 56,
  5: 60,
  6: 60,
  7: 63,
  8: 64,
  9: 63,
};

// Cache generated Poseidon instances per state size
const poseidonCache = new Map<number, PoseidonFn>();

/**
 * Get or create a Poseidon hash function for the given state size t.
 */
function getPoseidonForT(t: number): PoseidonFn {
  if (poseidonCache.has(t)) return poseidonCache.get(t)!;

  const roundsPartial = ROUNDS_PARTIAL[t];
  if (roundsPartial === undefined) {
    throw new Error(`Unsupported Poseidon state size t=${t}`);
  }

  // Generate constants using Grain LFSR
  const { roundConstants, mds } = grainGenConstants({
    Fp,
    t,
    roundsFull: ROUNDS_FULL,
    roundsPartial,
  });

  // Flatten round constants to bigint[][]
  const rc = roundConstants.map((row: bigint[]) => row.map((v) => BigInt(v)));
  const mdsMatrix = mds.map((row: bigint[]) => row.map((v) => BigInt(v)));

  // Create Poseidon hash function
  const hash = poseidon({
    Fp,
    t,
    roundsFull: ROUNDS_FULL,
    roundsPartial,
    sboxPower: 5,
    roundConstants: rc,
    mds: mdsMatrix,
  });

  poseidonCache.set(t, hash);
  return hash;
}

/**
 * Poseidon hash compatible with @zk-kit/smt (bigNumbers mode).
 *
 * Accepts 2 or 3 child nodes and returns a bigint.
 * For 2 inputs: uses t=3 (state = [0, input1, input2]), returns first element.
 * For 3 inputs: uses t=4 (state = [0, input1, input2, input3]).
 */
export function poseidonHash(childNodes: bigint[]): bigint {
  const t = childNodes.length + 1;
  const hash = getPoseidonForT(t);
  // Poseidon input: [0 (capacity), ...inputs]
  const state = [0n, ...childNodes];
  const result = hash(state);
  return result[0];
}

/**
 * Direct 2-input Poseidon hash.
 */
export function poseidon2(a: bigint, b: bigint): bigint {
  return poseidonHash([a, b]);
}

export { Fp, SECQ256R1_ORDER };
