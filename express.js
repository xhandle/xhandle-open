/**
 * xHandle: express module.
 * This file provides supporting logic for the xHandle codebase.
 * It participates in the broader local-first architecture by isolating one focused concern that other modules can build on.
 * Related files: src/App.js.
 */

const express = require("express");
const cors = require("cors");
const { logger } = require("./server/logger");

const app = express();
app.use(express.json());
app.use(cors());

let requirements = [
  { id: 1, title: "Requirement 1", status: "Draft" },
  { id: 2, title: "Requirement 2", status: "Approved" },
];

// Fetch all requirements
app.get("/api/requirements", (req, res) => {
  res.json(requirements);
});

// Add a new requirement
app.post("/api/requirements", (req, res) => {
  const newReq = { id: requirements.length + 1, ...req.body };
  requirements.push(newReq);
  res.json(newReq);
});

// Delete a requirement
app.delete("/api/requirements/:id", (req, res) => {
  const id = parseInt(req.params.id);
  requirements = requirements.filter((req) => req.id !== id);
  res.json({ message: "Requirement deleted" });
});

// Start server
app.listen(5002, () => {
logger.info("Server running on port 5000");
});
