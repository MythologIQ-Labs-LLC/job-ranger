import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadApprovedDriveFile, findCreatedDriveFile, verifyRecoveredDriveFile, DRIVE_OPERATION_PROPERTY, DriveTransportError } from "../src/pwa/drive/google-drive-transport.ts";

const secret = "NEVER_LOG_A_PROVIDER_TOKEN";
const document = new Blob(["Sojourner verified PDF test bytes"], { type: "application/pdf" });
const digest = async (blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
const good = async () => ({
  accessToken: secret,
  operationId: "op_314_verified_1",
  destinationId: "folder_123",
  name: "Sojourner-Resume.pdf",
  mimeType: "application/pdf",
  bytes: document,
  approvedSha256: await digest(document),
});
const remote = {
  id: "driveFile_123", name: "Sojourner-Resume.pdf",
  mimeType: "application/pdf", parents: ["folder_123"],
  size: String(document.size),
  appProperties: { [DRIVE_OPERATION_PROPERTY]: "op_314_verified_1" },
};
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

function driver(responses) {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url: String(url), options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.ok(response, "Unexpected network request");
    return response;
  };
  return { requests, fetchMock };
}

test("only one authorized POST creates the approved app-owned file, followed by exact metadata and byte readback", async () => {
  const { requests, fetchMock } = driver([json({ id: remote.id }), json(remote), new Response(document)]);
  const input = await good();
  const result = await uploadApprovedDriveFile(input, fetchMock);
  assert.deepEqual(result, {
    status: "verified", remoteId: remote.id, name: input.name,
    sha256: input.approvedSha256, openUrl: "https://drive.google.com/file/d/driveFile_123/view",
  });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(x => x.options.method ?? "GET"), ["POST", "GET", "GET"]);
  assert.ok(requests[0].url.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"));
  assert.ok(requests[1].url.includes("fields=id,name,mimeType,parents,size,appProperties"));
  assert.ok(requests[2].url.endsWith("alt=media"));
  for (const req of requests) {
    assert.equal(req.options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(req.options.redirect, "error");
    assert.equal(req.options.cache, "no-store");
    assert.equal(req.url.includes(secret), false);
  }
  const multipart = await requests[0].options.body.text();
  assert.match(multipart, /"parents":\["folder_123"\]/);
  assert.match(multipart, /"sojournerExportOperation":"op_314_verified_1"/);
  assert.match(multipart, /Sojourner verified PDF test bytes/);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("My Drive root alias resolves to an opaque folder ID before the first POST", async () => {
  const root = { id: "opaque_root_456", mimeType: "application/vnd.google-apps.folder" };
  const created = { ...remote, parents: [root.id] };
  const { requests, fetchMock } = driver([
    json(root), json({ id: remote.id }), json(created), new Response(document),
  ]);
  const result = await uploadApprovedDriveFile({ ...await good(), destinationId: "root" }, fetchMock);
  assert.equal(result.status, "verified");
  assert.equal(requests[0].url, "https://www.googleapis.com/drive/v3/files/root?fields=id,mimeType");
  assert.deepEqual(requests.map(x => x.options.method ?? "GET"), ["GET", "POST", "GET", "GET"]);
  assert.match(await requests[1].options.body.text(), /"parents":\["opaque_root_456"\]/);
});

test("if My Drive root cannot be verified, do not upload a single byte", async () => {
  const { requests, fetchMock } = driver([new Response("", { status: 403 })]);
  await assert.rejects(
    uploadApprovedDriveFile({ ...await good(), destinationId: "root" }, fetchMock),
    DriveTransportError,
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method ?? "GET", "GET");
});

test("reject invalid filename, destination, MIME and changed document before any fetch", async () => {
  const invalid = [
    { name: "../secret.pdf" },
    { name: "bad.pdf/child" },
    { name: "report.exe" },
    { mimeType: "application/zip", name: "report.zip" },
    { destinationId: "https://drive.google.com/evil" },
    { operationId: "O'Reilly" },
    { approvedSha256: "0".repeat(64) },
  ];
  for (const changed of invalid) {
    const input = { ...await good(), ...changed };
    let count = 0;
    await assert.rejects(uploadApprovedDriveFile(input, async () => { count++; throw Error("network"); }), DriveTransportError);
    assert.equal(count, 0, JSON.stringify(changed));
  }
});

test("deny invalid token, oversized upload, unsupported MIME and newline in token", async () => {
  for (const change of [
    { accessToken: "bad\nheader" },
    { accessToken: "" },
    { mimeType: "application/vnd.google-apps.document" },
    { bytes: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]) },
  ]) {
    await assert.rejects(uploadApprovedDriveFile({ ...await good(), ...change }, async () => { throw Error("must not fetch"); }), DriveTransportError);
  }
});

test("401, 403 and 429 expose actionable categories, without retries or token leakage", async () => {
  for (const [status, category] of [[401,"action_needed"], [403,"denied"], [429,"quota"]]) {
    const { requests, fetchMock } = driver([new Response("", { status })]);
    await assert.rejects(uploadApprovedDriveFile(await good(), fetchMock), error => {
      assert.equal(error.category, category);
      assert.equal(error.message.includes(secret), false);
      return true;
    });
    assert.equal(requests.length, 1);
  }
});

test("unknown remote result after connection loss, server error or invalid acknowledgement never initiates retry", async () => {
  for (const responses of [
    [new Error("connection lost")],
    [new Response("", { status: 503 })],
    [new Response("not json")],
    [json({ id: "https://evil.example/file" })],
  ]) {
    const { requests, fetchMock } = driver(responses);
    const result = await uploadApprovedDriveFile(await good(), fetchMock);
    assert.deepEqual(result.status, "unknown_remote_outcome");
    assert.equal(result.remoteId, null);
    assert.equal(requests.length, 1);
  }
});

test("metadata mismatch or unreadable/mismatching remote bytes never claim verified", async () => {
  const scenarios = [
    [json({ ...remote, parents: ["unexpected"] }), new Response(document)],
    [json({ ...remote, appProperties: {} }), new Response(document)],
    [json({ ...remote, size: "0" }), new Response(document)],
    [json(remote), new Response("different bytes")],
    [json(remote), new Response("", { status: 403 })],
  ];
  for (const [metadata, media] of scenarios) {
    const { requests, fetchMock } = driver([json({ id: remote.id }), metadata, media]);
    const result = await uploadApprovedDriveFile(await good(), fetchMock);
    assert.equal(result.status, "verification_failed");
    assert.equal(result.remoteId, remote.id);
    assert.equal(requests.filter(x => x.options.method === "POST").length, 1);
  }
});

test("appProperties reconciliation is exact, scoped and never launches upload", async () => {
  const cases = [
    [json({ files: [remote] }), { status: "found", remoteId: remote.id }],
    [json({ files: [] }), { status: "not_confirmed" }],
    [json({ files: [remote, { ...remote, id: "other" }] }), { status: "ambiguous" }],
    [json({ files: [remote], nextPageToken: "next" }), { status: "ambiguous" }],
    [json({ files: [remote], incompleteSearch: true }), { status: "ambiguous" }],
  ];
  for (const [response, expected] of cases) {
    const { requests, fetchMock } = driver([response]);
    const result = await findCreatedDriveFile(secret, "op_314_verified_1", fetchMock);
    assert.deepEqual(result, expected);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method ?? "GET", "GET");
    assert.ok(new URL(requests[0].url).searchParams.get("q").includes(DRIVE_OPERATION_PROPERTY));
    assert.equal(requests[0].url.includes(secret), false);
  }
});

test("recovery verifies existing file with metadata and readback, never issuing POST", async () => {
  const input = await good();
  const { requests, fetchMock } = driver([json(remote), new Response(document)]);
  const verified = await verifyRecoveredDriveFile(secret, {
    operationId: input.operationId, remoteId: remote.id, name: input.name,
    mimeType: input.mimeType, destinationId: input.destinationId,
    approvedSha256: input.approvedSha256,
  }, fetchMock);
  assert.equal(verified, true);
  assert.deepEqual(requests.map(x => x.options.method ?? "GET"), ["GET", "GET"]);
});

test("recovery refuses mismatching parent, marker, file size and bytes without creating files", async () => {
  const input = await good();
  const expected = { operationId: input.operationId, remoteId: remote.id,
    name: input.name, mimeType: input.mimeType, destinationId: input.destinationId,
    approvedSha256: input.approvedSha256 };
  for (const responses of [
    [json({ ...remote, parents: ["different"] })],
    [json({ ...remote, appProperties: {} })],
    [json({ ...remote, size: "0" })],
    [json(remote), new Response("incorrect bytes")],
    [new Response("", { status: 403 })],
  ]) {
    const { requests, fetchMock } = driver(responses);
    assert.equal(await verifyRecoveredDriveFile(secret, expected, fetchMock), false);
    assert.equal(requests.some(x => x.options.method === "POST"), false);
  }
});

test("recovery resolves My Drive root and does not POST or trust the literal root alias", async () => {
  const input = await good();
  const rootId = "opaque_root_456";
  const { requests, fetchMock } = driver([
    json({ id: rootId, mimeType: "application/vnd.google-apps.folder" }),
    json({ ...remote, parents: [rootId] }),
    new Response(document),
  ]);
  assert.equal(await verifyRecoveredDriveFile(secret, {
    operationId: input.operationId, remoteId: remote.id, name: input.name,
    mimeType: input.mimeType, destinationId: "root",
    approvedSha256: input.approvedSha256,
  }, fetchMock), true);
  assert.deepEqual(requests.map(x => x.options.method ?? "GET"), ["GET", "GET", "GET"]);
});

test("recovery accepts an approved uppercase PDF extension while rejecting unsafe filenames", async () => {
  const input = await good();
  const name = "Sojourner-Resume.PDF";
  const { requests, fetchMock } = driver([
    json({ ...remote, name }), new Response(document),
  ]);
  assert.equal(await verifyRecoveredDriveFile(secret, {
    operationId: input.operationId, remoteId: remote.id, name,
    mimeType: "application/pdf", destinationId: input.destinationId,
    approvedSha256: input.approvedSha256,
  }, fetchMock), true);
  assert.equal(requests.some(x => x.options.method === "POST"), false);
  for (const unsafe of ["../resume.pdf", "resume.pdf/child", " resume.pdf"]) {
    let calls = 0;
    assert.equal(await verifyRecoveredDriveFile(secret, {
      operationId: input.operationId, remoteId: remote.id, name: unsafe,
      mimeType: "application/pdf", destinationId: input.destinationId,
      approvedSha256: input.approvedSha256,
    }, async () => { calls++; throw new Error("unexpected request"); }), false);
    assert.equal(calls, 0);
  }
});

test("recovery rejects missing remote IDs and malformed My Drive root metadata", async () => {
  const input = await good();
  const base = { operationId: input.operationId, remoteId: remote.id,
    name: input.name, mimeType: input.mimeType,
    destinationId: "root", approvedSha256: input.approvedSha256 };
  for (const root of [
    {}, { mimeType: "application/vnd.google-apps.folder" },
    { id: null, mimeType: "application/vnd.google-apps.folder" },
  ]) {
    const { requests, fetchMock } = driver([json(root)]);
    assert.equal(await verifyRecoveredDriveFile(secret, base, fetchMock), false);
    assert.equal(requests.length, 1);
    assert.equal(requests.some(x => x.options.method === "POST"), false);
  }
  for (const invalid of [{ remoteId: undefined }, { destinationId: undefined }]) {
    let calls = 0;
    assert.equal(await verifyRecoveredDriveFile(secret, { ...base, ...invalid },
      async () => { calls++; throw new Error("unexpected"); }), false);
    assert.equal(calls, 0);
  }
});

test("recovered receipts with missing typed fields fail closed before network access", async () => {
  const input = await good();
  const valid = { operationId: input.operationId, remoteId: remote.id,
    name: input.name, mimeType: input.mimeType, destinationId: input.destinationId,
    approvedSha256: input.approvedSha256 };
  const cases = [
    { name: undefined }, { name: null }, { name: 42 },
    { approvedSha256: undefined }, { operationId: undefined },
    { remoteId: null }, { destinationId: null },
  ];
  for (const invalid of cases) {
    let calls = 0;
    assert.equal(await verifyRecoveredDriveFile(secret, { ...valid, ...invalid },
      async () => { calls++; throw new Error("unexpected network call"); }), false,
      JSON.stringify(invalid));
    assert.equal(calls, 0);
  }
});

test("malformed recovery search entries stay ambiguous without a second upload", async () => {
  for (const files of [[null], [null, remote], [42], ["invalid"], [remote, null]]) {
    const { requests, fetchMock } = driver([json({ files })]);
    const result = await findCreatedDriveFile(secret, "op_314_verified_1", fetchMock);
    assert.deepEqual(result, { status: "ambiguous" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method ?? "GET", "GET");
  }
});

test("pre-POST failure never commits uploading; successful preflight commits before POST", async () => {
  const input = { ...await good(), destinationId: "root" };
  let commits = 0;
  const denied = driver([json({}, 403)]);
  await assert.rejects(uploadApprovedDriveFile(input, denied.fetchMock,
    async () => { commits++; }), DriveTransportError);
  assert.equal(commits, 0);
  assert.deepEqual(denied.requests.map(x => x.options.method ?? "GET"), ["GET"]);

  const stopped = driver([json({ id: "rootOpaque", mimeType: "application/vnd.google-apps.folder" })]);
  await assert.rejects(uploadApprovedDriveFile(input, stopped.fetchMock,
    async () => { commits++; throw new Error("journal commit failed"); }), /journal commit failed/);
  assert.equal(commits, 1);
  assert.deepEqual(stopped.requests.map(x => x.options.method ?? "GET"), ["GET"]);

  const successful = driver([
    json({ id: "rootOpaque", mimeType: "application/vnd.google-apps.folder" }),
    json({ id: remote.id }), json({ ...remote, parents: ["rootOpaque"] }), new Response(document),
  ]);
  let durable = false;
  const verified = await uploadApprovedDriveFile(input, async (url, options) => {
    if (options.method === "POST") assert.equal(durable, true);
    return successful.fetchMock(url, options);
  }, async () => { durable = true; });
  assert.equal(verified.status, "verified");
  assert.deepEqual(successful.requests.map(x => x.options.method ?? "GET"),
    ["GET", "POST", "GET", "GET"]);
});

test("invalid input and digest mismatch never enter the durable upload boundary", async () => {
  for (const change of [
    { name: "../unsafe.pdf" },
    { approvedSha256: "0".repeat(64) },
  ]) {
    let requests = 0;
    let durableTransitions = 0;
    await assert.rejects(uploadApprovedDriveFile(
      { ...await good(), ...change },
      async () => { requests++; throw new Error("unexpected network access"); },
      async () => { durableTransitions++; },
    ), DriveTransportError);
    assert.equal(requests, 0);
    assert.equal(durableTransitions, 0);
  }
});

test("ambiguous POST is reported only after the caller's durable boundary succeeds", async () => {
  let durable = false;
  let posts = 0;
  const outcome = await uploadApprovedDriveFile(await good(), async (_url, options) => {
    assert.equal(options.method, "POST");
    assert.equal(durable, true, "remote POST must follow durable uploading transition");
    posts++;
    throw new Error("network failed after POST began");
  }, async () => { durable = true; });
  assert.equal(posts, 1);
  assert.deepEqual(outcome, {
    status: "unknown_remote_outcome",
    remoteId: null,
    reason: "The upload connection was interrupted. Check Drive before approving another export.",
  });
});
