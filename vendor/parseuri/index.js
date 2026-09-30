"use strict";

module.exports = function parseuri(source) {
  const input = String(source || "");
  const url = new URL(input.includes("://") ? input : `http://${input}`);
  const path = url.pathname || "/";
  const slash = path.lastIndexOf("/");
  const query = url.search.slice(1);
  const queryKey = {};
  for (const part of query.split("&")) {
    if (!part) continue;
    const separator = part.indexOf("=");
    const key = separator < 0 ? part : part.slice(0, separator);
    if (key) queryKey[key] = separator < 0 ? "" : part.slice(separator + 1);
  }

  return {
    source: input,
    protocol: url.protocol.slice(0, -1),
    authority: url.host,
    userInfo: url.username ? `${url.username}${url.password ? `:${url.password}` : ""}` : "",
    user: url.username,
    password: url.password,
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port,
    relative: `${path}${url.search}${url.hash}`,
    path,
    directory: path.slice(0, slash + 1),
    file: path.slice(slash + 1),
    query,
    anchor: url.hash.slice(1),
    ipv6uri: url.hostname.startsWith("["),
    pathNames: path.split("/").filter(Boolean),
    queryKey,
  };
};
