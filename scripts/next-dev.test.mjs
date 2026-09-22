import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { devDistDir, findAvailablePort, parseDevPort } from "./next-dev.mjs";

test("uses an isolated Next.js development directory for each port", () => {
  assert.equal(parseDevPort([]), 3000);
  assert.equal(parseDevPort(["--port", "3001"]), 3001);
  assert.equal(parseDevPort(["-p", "3010"]), 3010);
  assert.equal(devDistDir(3001), ".next-dev-3001");
});

test("skips a port occupied on the wildcard address", async (context) => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, resolve);
  });
  context.after(() => server.close());

  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, "string");
  const availablePort = await findAvailablePort(address.port);
  assert.notEqual(availablePort, address.port);
});
