import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { pathToFileURL } from "node:url";

const DEFAULT_PORT = 3000;

export function parseDevPort(args) {
  const index = args.findIndex((argument) => argument === "--port" || argument === "-p");
  if (index === -1) return DEFAULT_PORT;

  const port = Number(args[index + 1]);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT;
}

export function devDistDir(port) {
  return `.next-dev-${port}`;
}

function hasExplicitPort(args) {
  return args.some((argument) => argument === "--port" || argument === "-p");
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findAvailablePort(startPort) {
  for (let port = startPort; port <= 65_535; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error("No development port is available.");
}

async function run() {
  const args = process.argv.slice(2);
  const explicitPort = hasExplicitPort(args);
  const requestedPort = parseDevPort(args);
  const port = explicitPort ? requestedPort : await findAvailablePort(requestedPort);
  const nextArgs = explicitPort ? args : [...args, "--port", String(port)];
  const require = createRequire(import.meta.url);
  const nextBin = require.resolve("next/dist/bin/next");

  const child = spawn(process.execPath, [nextBin, "dev", ...nextArgs], {
    env: { ...process.env, NEXT_DIST_DIR: devDistDir(port) },
    stdio: "inherit",
  });

  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
