# moica-revocation-smt

> **Note:** This project has moved to [moven0831/moica-revocation-smt](https://github.com/moven0831/moica-revocation-smt). The SMT update pipeline in this repo is deprecated and disabled.

Converts MOICA Certificate Revocation Lists (CRL) into a Sparse Merkle Tree (SMT) for ZK non-membership proofs. The pipeline fetches Taiwan's MOICA CRL, parses revoked certificate serials, builds an SMT using Poseidon hash over the secq256r1 scalar field, and posts the root on-chain.

## Architecture

```
MOICA CRL (DER) → fetch-crl.ts → parse serials → build-smt.ts → SMT root
                                                                    ↓
                  data/g2/revoked-serials.json ← persist        post-root.ts
                  data/g2/root.json            ← persist            ↓
                                                              SMTRootStorage.sol
```

## Quick Start

```bash
nvm use 22
pnpm install

# Fetch CRL and save serials
pnpm fetch

# Build SMT from serials
pnpm build:smt

# Post root on-chain (requires env vars)
pnpm post:root
```

## Data Format

### `data/g2/revoked-serials.json`
Sorted array of hex serial numbers (128-bit):
```json
["100048210dd2df2e128096a9282b5ec5", "200048210dd2df2e128096a9282b5ec5", ...]
```

### `data/g2/root.json`
```json
{
  "root": "0x3c2151...",
  "crlNumber": "2026031610",
  "timestamp": "2026-03-16T08:00:00.000Z",
  "count": 412404
}
```

## Contract

**SMTRootStorage.sol** — on-chain registry for SMT roots.

| Function | Description |
|----------|-------------|
| `setRoot(bytes32 issuerId, uint256 root, uint256 crlNumber)` | Update root (relayer only, monotonic CRL number) |
| `getRoot(bytes32 issuerId) → uint256` | Read current root |

Issuer IDs: `keccak256("MOICA-G2")`, `keccak256("MOICA-G3")`

Deploy with Hardhat Ignition:
```bash
pnpm hardhat ignition deploy ignition/modules/SMTRootStorage.ts --parameters '{"relayer":"0x..."}'
```

## Generating Non-Membership Proofs

```typescript
import { buildSmtFromSerials, generateProof } from "./src/build-smt.js";
import serials from "./data/g2/revoked-serials.json";

const { tree } = buildSmtFromSerials(serials);
const proof = generateProof(tree, "your-serial-hex-here");
// proof.membership === false means certificate is NOT revoked
```

## Poseidon Hash

Uses Poseidon over the **secq256r1 scalar field** (`p = 0xFFFF...2551`), generated via `@noble/curves` Grain LFSR. Parameters: sbox x^5, 8 full rounds, 57 partial rounds (t=3).

## Tests

```bash
pnpm test                                  # All tests
pnpm hardhat test test/build-smt.test.ts   # SMT + Poseidon only
pnpm hardhat test test/fetch-crl.test.ts   # CRL parsing (network)
```

## Data Scale

| CRL | Revoked Certs | File Size |
|-----|--------------|-----------|
| G2  | ~412,000     | ~20MB DER |
| G3  | ~103,000     | ~5MB DER (URL TBD) |

## References

- [MOICA](https://moica.nat.gov.tw/) — Taiwan citizen digital certificate
- [Poseidon Hash](https://www.poseidon-hash.info/) — ZK-friendly hash function
- [Hadeshash spec](https://eprint.iacr.org/2019/458.pdf) — Round number parameters
- [zkID](https://github.com/zkmopro/zkID) — ZK identity verification project
