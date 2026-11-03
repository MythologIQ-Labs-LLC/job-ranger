const assert = require("node:assert/strict");

const {
  AcquisitionNetworkPolicyError,
  assertPublicAcquisitionUrl,
  isPublicIpv4,
  isPublicIpv6,
  validateAcquisitionUrlSyntax,
} = require("../electron-runtime/electron/src/acquisition-network-policy.cjs");
const { fetchJson } = require("../electron-runtime/electron/src/scrapers.cjs");

function assertPolicyRejects(operation) {
  return assert.rejects(operation, (error) => {
    assert.equal(error instanceof AcquisitionNetworkPolicyError, true);
    assert.equal(error.code, "acquisition-network-policy");
    assert.doesNotMatch(error.message, /127\.0\.0\.1|192\.168|10\.0\./);
    return true;
  });
}

async function run() {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isPublicIpv4(address), false, `${address} must not be public`);
  }
  assert.equal(isPublicIpv4("8.8.8.8"), true);
  assert.equal(isPublicIpv4("1.1.1.1"), true);

  for (const address of [
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.1.1",
  ]) {
    assert.equal(isPublicIpv6(address), false, `${address} must not be public`);
  }
  assert.equal(isPublicIpv6("2606:4700:4700::1111"), true);

  for (const url of [
    "http://localhost/careers",
    "https://jobs.localhost/",
    "http://127.0.0.1/jobs",
    "http://10.1.2.3/jobs",
    "http://[::1]/jobs",
    "http://user:pass@example.com/jobs",
    "file:///etc/passwd",
  ]) {
    assert.throws(() => validateAcquisitionUrlSyntax(url), AcquisitionNetworkPolicyError);
  }

  assert.equal(
    validateAcquisitionUrlSyntax("https://careers.example.com/jobs").toString(),
    "https://careers.example.com/jobs",
  );

  const publicResolver = async () => ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"];
  assert.equal(
    await assertPublicAcquisitionUrl("https://careers.example.com/jobs", publicResolver),
    "https://careers.example.com/jobs",
  );

  await assertPolicyRejects(() =>
    assertPublicAcquisitionUrl("https://careers.example.com/jobs", async () => ["127.0.0.1"]),
  );
  await assertPolicyRejects(() =>
    assertPublicAcquisitionUrl("https://careers.example.com/jobs", async () => ["93.184.216.34", "10.0.0.2"]),
  );
  await assertPolicyRejects(() =>
    assertPublicAcquisitionUrl("https://careers.example.com/jobs", async () => []),
  );
  await assertPolicyRejects(() =>
    assertPublicAcquisitionUrl("https://careers.example.com/jobs", async () => {
      throw new Error("dns lookup detail that should not escape");
    }),
  );

  const fetchCalls = [];
  const redirectingFetch = async (url) => {
    fetchCalls.push(String(url));
    if (String(url) === "https://public.example/jobs") {
      return new Response(null, {
        status: 302,
        headers: { location: "http://internal.example/admin" },
      });
    }
    throw new Error("The private redirect target must never be fetched");
  };
  const redirectResolver = async (hostname) =>
    hostname === "public.example" ? ["93.184.216.34"] : ["10.0.0.5"];

  await assertPolicyRejects(() =>
    fetchJson("https://public.example/jobs", {
      fetchImpl: redirectingFetch,
      userAgent: "Sojourner Test",
      timeoutMs: 1000,
      retryCount: 0,
      resolveHost: redirectResolver,
    }),
  );
  assert.deepEqual(fetchCalls, ["https://public.example/jobs"]);

  console.log("Acquisition network policy tests passed!");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
