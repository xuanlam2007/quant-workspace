if (process.platform === "win32") {
  const childProcess = require("node:child_process");
  const { syncBuiltinESMExports } = require("node:module");
  const nativeSpawn = childProcess.ChildProcess.prototype.spawn;
  childProcess.ChildProcess.prototype.spawn = function (options) {
    return Reflect.apply(nativeSpawn, this, [{ ...options, windowsHide: true }]);
  };

  // Chỉ áp dụng cho tiến trình phát triển và các tiến trình con của nó.
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    const original = childProcess[name];
    childProcess[name] = function (...args) {
      const acceptsArgv = !["exec", "execSync"].includes(name);
      const index = acceptsArgv && (Array.isArray(args[1]) || args[1] == null && args.length > 2) ? 2 : 1;
      const options = args[index];
      if (typeof options === "function") args.splice(index, 0, { windowsHide: true });
      else args[index] = { ...options, windowsHide: true };
      return Reflect.apply(original, this, args);
    };
  }
  syncBuiltinESMExports();
}
