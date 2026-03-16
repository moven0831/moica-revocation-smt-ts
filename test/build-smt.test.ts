import { expect } from "chai";
import { poseidonHash } from "../src/utils/poseidon.js";
import { buildSmtFromSerials, generateProof } from "../src/build-smt.js";

describe("SMT Builder", function () {
  this.timeout(30000);

  const testSerials = [
    "100048210DD2DF2E128096A9282B5EC5",
    "200048210DD2DF2E128096A9282B5EC5",
    "300048210DD2DF2E128096A9282B5EC5",
    "400048210DD2DF2E128096A9282B5EC5",
    "500048210DD2DF2E128096A9282B5EC5",
    "600048210DD2DF2E128096A9282B5EC5",
    "700048210DD2DF2E128096A9282B5EC5",
    "800048210DD2DF2E128096A9282B5EC5",
    "900048210DD2DF2E128096A9282B5EC5",
    "A00048210DD2DF2E128096A9282B5EC5",
  ];

  it("should build SMT from known serials", function () {
    const result = buildSmtFromSerials(testSerials);
    expect(result.count).to.equal(10);
    expect(result.root).to.be.a("bigint");
    expect(result.root).to.not.equal(0n);
  });

  it("should produce deterministic roots", function () {
    const result1 = buildSmtFromSerials(testSerials);
    const result2 = buildSmtFromSerials(testSerials);
    expect(result1.root).to.equal(result2.root);
  });

  it("should generate valid membership proof for included serial", function () {
    const { tree } = buildSmtFromSerials(testSerials);
    const proof = generateProof(tree, testSerials[0]);
    expect(proof.membership).to.be.true;
    expect(tree.verifyProof(proof)).to.be.true;
  });

  it("should generate valid non-membership proof for excluded serial", function () {
    const { tree } = buildSmtFromSerials(testSerials);
    const proof = generateProof(tree, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
    expect(proof.membership).to.be.false;
    expect(tree.verifyProof(proof)).to.be.true;
  });
});

describe("Poseidon secq256r1", function () {
  it("should produce deterministic hashes", function () {
    const h1 = poseidonHash([1n, 2n]);
    const h2 = poseidonHash([1n, 2n]);
    expect(h1).to.equal(h2);
  });

  it("should produce results within the field", function () {
    const SECQ256R1_ORDER =
      0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    const h = poseidonHash([1n, 2n]);
    expect(h).to.be.lessThan(SECQ256R1_ORDER);
  });

  it("should handle 3-input hashing", function () {
    const h = poseidonHash([1n, 2n, 3n]);
    expect(h).to.be.a("bigint");
    expect(h).to.not.equal(0n);
  });
});
