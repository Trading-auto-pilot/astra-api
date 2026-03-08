// lib/dockerClient.js
"use strict";

const http = require("http");

const SOCKET_PATH = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

function dockerRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: SOCKET_PATH,
      path,
      method,
      headers: { "Content-Type": "application/json" },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = {
  listContainers() {
    return dockerRequest("GET", "/containers/json?all=1");
  },

  inspectContainer(name) {
    return dockerRequest("GET", `/containers/${encodeURIComponent(name)}/json`);
  },

  startContainer(name) {
    return dockerRequest("POST", `/containers/${encodeURIComponent(name)}/start`);
  },

  stopContainer(name) {
    return dockerRequest("POST", `/containers/${encodeURIComponent(name)}/stop`);
  },

  restartContainer(name) {
    return dockerRequest("POST", `/containers/${encodeURIComponent(name)}/restart`);
  },
};
