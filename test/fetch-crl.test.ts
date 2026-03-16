import { expect } from "chai";
import { parseCrl } from "../src/fetch-crl.js";

describe("CRL Parser", function () {
  this.timeout(60000);

  it("should parse a real G2 CRL from network", async function () {
    const url = "https://moica.nat.gov.tw/repository/MOICA/CRL2/complete.crl";
    const response = await fetch(url);
    if (!response.ok) {
      this.skip();
      return;
    }
    const derBuffer = await response.arrayBuffer();
    const result = parseCrl(derBuffer);

    expect(result.serials).to.be.an("array");
    expect(result.serials.length).to.be.greaterThan(100000);
    expect(result.crlNumber).to.not.equal("unknown");
    expect(result.lastUpdate).to.be.instanceOf(Date);

    // Serial numbers should be hex strings
    for (const serial of result.serials.slice(0, 10)) {
      expect(serial).to.match(/^[0-9a-f]+$/i);
    }

    console.log(
      `G2 CRL: ${result.serials.length} serials, CRL #${result.crlNumber}`
    );
  });
});
