/**
 * xHandle: config overrides module.
 * This file provides supporting logic for the xHandle codebase.
 * It participates in the broader local-first architecture by isolating one focused concern that other modules can build on.
 * Related files: src/App.js.
 */

const webpack = require("webpack");
const dotenv = require("dotenv");

module.exports = function override(config) {
  config.resolve.fallback = {
    ...config.resolve.fallback,
    console: require.resolve("console-browserify"),
  };

  const env = dotenv.config().parsed || {};

  const envKeys = Object.keys(env).reduce((prev, next) => {
    prev[`process.env.${next}`] = JSON.stringify(env[next]);
    return prev;
  }, {});

  // Conditionally set BACKEND_URL based on LOCAL_DEV
  if (process.env.LOCAL_DEV === "true") {
    envKeys["process.env.BACKEND_URL"] = JSON.stringify(
      "http://localhost:5001"
    );
  }

  config.plugins.push(new webpack.DefinePlugin(envKeys));

  return config;
};
