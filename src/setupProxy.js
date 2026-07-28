// src/setupProxy.js
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target: "http://localhost:5001", // IMPORTANT: no trailing /api here
      changeOrigin: true,
      logLevel: "debug", // see what CRA is doing
      pathRewrite: (path) => {
        // Keep the /api prefix exactly as-is (identity rewrite)
        console.log("[proxy] incoming:", path);
        return path;
      },
      onProxyReq(proxyReq) {
        console.log("[proxy] forwarding to:", proxyReq.path);
      },
    })
  );
};
