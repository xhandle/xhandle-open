const {
  ensureHazardSummaryEvidenceColumns,
} = require("./codeArchitectureHazardUtils");
const {
  enrichHazardTableRowsWithSourceContent,
} = require("./codeArchitectureHazardSourceAudit");

function rowObject(summary, rowIndex = 1) {
  const headers = summary[0];
  const row = summary[rowIndex];
  return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
}

describe("code architecture hazard evidence review", () => {
  it("loads per-row indexed source before classifying code relationship direction", async () => {
    const content = [
      "def dxy_theta_to_v(dxy):",
      "    matrix = construct_DTD(dxy)",
      "    return matrix",
      "",
      "def construct_DTD(dxy):",
      "    return dxy",
    ].join("\n");
    const rows = [{
      rowRef: "49",
      fromFunction: "construct_DTD",
      controlAction: "Provide matrix",
      toFunction: "dxy_theta_to_v",
      sourceFiles: ["src/alpamayo1_5/action_space/utils.py"],
      codeEvidence: {
        sourceFunctions: [
          { functionName: "construct_DTD", filePath: "src/alpamayo1_5/action_space/utils.py", startLine: 5, endLine: 6 },
          { functionName: "dxy_theta_to_v", filePath: "src/alpamayo1_5/action_space/utils.py", startLine: 1, endLine: 3 },
        ],
      },
    }];
    const enrichedRows = await enrichHazardTableRowsWithSourceContent(rows, { owner: "NVlabs", repo: "alpamayo1_5" }, {
      loadSourceRecord: async ({ filePath }) => ({
        filePath,
        content,
        sourceFunctions: [
          { functionName: "dxy_theta_to_v", filePath, startLine: 1, endLine: 3 },
          { functionName: "construct_DTD", filePath, startLine: 5, endLine: 6 },
        ],
      }),
    });
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
        "Safety Significant",
        "Safety Significance Rationale",
      ], [
        "49",
        "construct_DTD",
        "Provide matrix",
        "dxy_theta_to_v",
        "If construct_DTD provides an incorrect matrix to dxy_theta_to_v, the velocity estimate may be wrong.",
        "Yes",
        "Generated hazard was initially marked safety significant.",
      ]],
    };

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, enrichedRows);
    const row = rowObject(reviewed.Summary);

    expect(enrichedRows[0].codeEvidence.sourceAudit.mode).toBe("per-row-indexed-source");
    expect(row["Evidence Classification"]).toBe("Contradicted by code relationship");
    expect(row["Code Relationship Audit"]).toMatch(/reverse call evidence/i);
  });

  it("keeps an unused validator hazard significant when repo-wide usage proves no call sites", async () => {
    const content = [
      "def get_action_space_dims(self):",
      "    return (2,)",
      "",
      "def is_within_bounds(self, action):",
      "    return True",
      "",
      "def action_to_traj(self, action):",
      "    return action",
    ].join("\n");
    const rows = [{
      rowRef: "40",
      fromFunction: "is_within_bounds",
      controlAction: "Validate action bounds",
      toFunction: "action_to_traj",
      sourceFiles: ["src/alpamayo1_5/action_space/unicycle_accel_curvature.py"],
      codeEvidence: {
        sourceFunctions: [
          { functionName: "is_within_bounds", filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py", startLine: 4, endLine: 5 },
          { functionName: "action_to_traj", filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py", startLine: 7, endLine: 8 },
        ],
      },
    }];
    const sourceRecord = {
      path: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py",
      content,
      sourceFunctions: [
        { functionName: "get_action_space_dims", filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py", startLine: 1, endLine: 2 },
        { functionName: "is_within_bounds", filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py", startLine: 4, endLine: 5 },
        { functionName: "action_to_traj", filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py", startLine: 7, endLine: 8 },
      ],
    };
    const enrichedRows = await enrichHazardTableRowsWithSourceContent(rows, { owner: "NVlabs", repo: "alpamayo1_5" }, {
      loadSourceRecord: async () => sourceRecord,
      allSourceRecords: [sourceRecord],
    });
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
        "Safety Significant",
        "Safety Significance Rationale",
      ], [
        "40",
        "is_within_bounds",
        "Validate action bounds",
        "action_to_traj",
        "Sampled actions may be converted into predicted trajectories without evidence that available acceleration and curvature bounds are enforced on the sampled output path.",
        "Needs Review",
        "Generated row needed review.",
      ]],
    };

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, enrichedRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Code-supported independent finding");
    expect(row.Confidence).toBe("High");
    expect(row["Safety Significant"]).toBe("Yes");
    expect(row["Repo-Wide Usage Audit"]).toMatch(/zero call sites/i);
  });

  it("adds a source-audit row when extract_traj_tokens exists but is not traced", async () => {
    const content = [
      "def extract_traj_tokens(token_values):",
      "    invalid_tokens = (token_values < 0)",
      "    token_values = torch.clamp(token_values, min=0)",
      "    return token_values",
    ].join("\n");
    const sourceRecord = {
      path: "src/alpamayo1_5/models/token_utils.py",
      content,
      sourceFunctions: [
        { functionName: "extract_traj_tokens", filePath: "src/alpamayo1_5/models/token_utils.py", startLine: 1, endLine: 4 },
      ],
    };
    const enrichedRows = await enrichHazardTableRowsWithSourceContent([], { owner: "NVlabs", repo: "alpamayo1_5" }, {
      allSourceRecords: [sourceRecord],
    });
    const reviewed = ensureHazardSummaryEvidenceColumns({
      Summary: [["Architecture Row Ref", "Function (From)", "Control Action", "Function (To)", "Hazards", "Safety Significant"]],
    }, enrichedRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Architecture Row Ref"]).toBe("source-audit-extract-traj-tokens");
    expect(row["Function (From)"]).toBe("extract_traj_tokens");
    expect(row["Evidence Classification"]).toBe("Contradicted or mitigated by code");
    expect(row["Recommended Mitigation"]).toMatch(/trajectory token sequences/i);
  });

  it("adds extract_traj_tokens source-audit coverage from simple indexed function names", async () => {
    const sourceRecord = {
      path: "src/alpamayo1_5/models/token_utils.py",
      content: "def extract_traj_tokens(token_values):\n    return torch.clamp(token_values, min=0)",
      functions: ["extract_text_tokens", "extract_traj_tokens"],
    };
    const enrichedRows = await enrichHazardTableRowsWithSourceContent([], { owner: "NVlabs", repo: "alpamayo1_5" }, {
      allSourceRecords: [sourceRecord],
    });
    const reviewed = ensureHazardSummaryEvidenceColumns({
      Summary: [["Architecture Row Ref", "Function (From)", "Control Action", "Function (To)", "Hazards", "Safety Significant"]],
    }, enrichedRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Architecture Row Ref"]).toBe("source-audit-extract-traj-tokens");
    expect(row["Function (From)"]).toBe("extract_traj_tokens");
    expect(row["Recommended Verification"]).toMatch(/token contract tests/i);
  });

  it("adds extract_traj_tokens coverage from the Python top-level discovery audit", async () => {
    const sourceRecord = {
      path: "src/alpamayo1_5/models/token_utils.py",
      content: "def extract_text_tokens(values):\n    return values\n\ndef extract_traj_tokens(token_values):\n    return torch.clamp(token_values, min=0)",
      sourceFunctions: [{ functionName: "extract_text_tokens", filePath: "src/alpamayo1_5/models/token_utils.py", startLine: 1, endLine: 2 }],
      sourceAudit: {
        pythonTopLevelFunctions: [
          { name: "extract_text_tokens", line: 1 },
          { name: "extract_traj_tokens", line: 4 },
        ],
        missingFromSourceFunctions: ["extract_traj_tokens"],
      },
    };
    const enrichedRows = await enrichHazardTableRowsWithSourceContent([], { owner: "NVlabs", repo: "alpamayo1_5" }, {
      allSourceRecords: [sourceRecord],
    });
    const reviewed = ensureHazardSummaryEvidenceColumns({
      Summary: [["Architecture Row Ref", "Function (From)", "Control Action", "Function (To)", "Hazards", "Safety Significant"]],
    }, enrichedRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Architecture Row Ref"]).toBe("source-audit-extract-traj-tokens");
    expect(row["Function (From)"]).toBe("extract_traj_tokens");
    expect(row["Code Evidence"]).toMatch(/Referenced code evidence/i);
  });

  it("adds a separate extract_traj_tokens row even when the symbol appears as evidence on a neighboring token row", async () => {
    const sourceRecord = {
      path: "src/alpamayo1_5/models/token_utils.py",
      content: [
        "def extract_text_tokens(values):",
        "    return extract_between_special_tokens(values)",
        "",
        "def extract_between_special_tokens(values):",
        "    return values",
        "",
        "def extract_traj_tokens(token_values):",
        "    return torch.clamp(token_values, min=0)",
      ].join("\n"),
      sourceFunctions: [
        { functionName: "extract_text_tokens", filePath: "src/alpamayo1_5/models/token_utils.py", startLine: 1, endLine: 2 },
        { functionName: "extract_between_special_tokens", filePath: "src/alpamayo1_5/models/token_utils.py", startLine: 4, endLine: 5 },
        { functionName: "extract_traj_tokens", filePath: "src/alpamayo1_5/models/token_utils.py", startLine: 7, endLine: 8 },
      ],
    };
    const neighboringRows = [{
      rowRef: "82",
      fromFunction: "extract_text_tokens",
      controlAction: "Extract text tokens",
      toFunction: "extract_between_special_tokens",
      sourceFiles: ["src/alpamayo1_5/models/token_utils.py"],
      codeEvidence: {
        files: [{
          filePath: "src/alpamayo1_5/models/token_utils.py",
          content: sourceRecord.content,
          sourceFunctions: sourceRecord.sourceFunctions,
        }],
        sourceFunctions: sourceRecord.sourceFunctions,
      },
      sourceEvidence: {
        functions: sourceRecord.sourceFunctions,
      },
    }];
    const enrichedRows = await enrichHazardTableRowsWithSourceContent(neighboringRows, { owner: "NVlabs", repo: "alpamayo1_5" }, {
      loadSourceRecord: async () => sourceRecord,
      allSourceRecords: [sourceRecord],
    });
    const reviewed = ensureHazardSummaryEvidenceColumns({
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
        "Safety Significant",
      ], [
        "82",
        "extract_text_tokens",
        "Extract text tokens",
        "extract_between_special_tokens",
        "Token extraction may mishandle invalid values.",
        "Needs Review",
      ]],
    }, enrichedRows);
    const rows = reviewed.Summary.slice(1).map((_, index) => rowObject(reviewed.Summary, index + 1));
    const neighboringRow = rows.find((row) => row["Function (From)"] === "extract_text_tokens");
    const sourceAuditRow = rows.find((row) => row["Function (From)"] === "extract_traj_tokens");

    expect(rows.some((row) => row["Function (From)"] === "extract_text_tokens")).toBe(true);
    expect(rows.some((row) => row["Function (From)"] === "extract_traj_tokens")).toBe(true);
    expect(neighboringRow["Recommended Mitigation"]).not.toMatch(/trajectory token sequences/i);
    expect(sourceAuditRow["Architecture Row Ref"]).toBe("source-audit-extract-traj-tokens");
    expect(sourceAuditRow["Recommended Mitigation"]).toMatch(/trajectory token sequences/i);
  });

  it("flags action-space bounds as symbol-supported when the edge direction is not explicitly verified", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
        "Unsafe Control Actions",
        "Safety Requirements/Constraints",
      ], [
        "31",
        "get_action_space_dims",
        "Retrieve action space dims",
        "is_within_bounds",
        "If get_action_space_dims provides incorrect dimensions, is_within_bounds may validate actions against wrong bounds, leading to invalid actions being accepted, which results in unsafe trajectory execution.",
        "The Retrieve action space dims action provides incorrect dimensions.",
        "Ensure is_within_bounds uses synchronized action space dimensions.",
      ]],
    };
    const tableRows = [{
      rowRef: "31",
      fromFunction: "get_action_space_dims",
      controlAction: "Retrieve action space dims",
      toFunction: "action_to_traj",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "get_action_space_dims", filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py", startLine: 100 },
          { functionName: "is_within_bounds", filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py", startLine: 104 },
          { functionName: "action_to_traj", filePath: "src/alpamayo1_5/models/alpamayo1_5.py", startLine: 384 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Symbol-supported, edge unverified");
    expect(row["Safety Concern Type"]).toBe("Safety-critical");
    expect(row.Confidence).toBe("Medium");
    expect(row.Hazards).toMatch(/without evidence.*bounds are enforced/i);
    expect(row["Code Evidence"]).toMatch(/does not prove the claimed edge direction/i);
    expect(row["Mitigation Evidence"]).toMatch(/No reject\/resample\/filter evidence/i);
  });

  it("keeps high confidence for action-space rows only when direct relationship evidence is present", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "31",
        "action_to_traj",
        "Transform action",
        "traj_to_action",
        "If action_to_traj converts sampled actions without enforcing acceleration and curvature bounds, the returned trajectory may be unsafe.",
      ]],
    };
    const tableRows = [{
      rowRef: "31",
      fromFunction: "action_to_traj",
      controlAction: "Transform action",
      toFunction: "traj_to_action",
      sourceEvidence: {
        relationshipType: "direct_call",
        verification: "ast_verified",
      },
      codeEvidence: {
        sourceFunctions: [
          { functionName: "action_to_traj", filePath: "src/alpamayo1_5/models/alpamayo1_5.py", startLine: 384 },
          { functionName: "is_within_bounds", filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py", startLine: 104 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Code-supported");
    expect(row.Confidence).toBe("High");
    expect(row["Code Evidence"]).toMatch(/explicit relationship evidence/i);
  });

  it("verifies direct calls from indexed source content", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "40",
        "action_to_traj",
        "Transform action",
        "is_within_bounds",
        "Sampled actions may be converted into predicted trajectories without evidence that available acceleration and curvature bounds are enforced on the sampled output path.",
      ]],
    };
    const content = [
      "def action_to_traj(action):",
      "    if not is_within_bounds(action):",
      "        raise ValueError('bad action')",
      "    return action",
      "",
      "def is_within_bounds(action):",
      "    return True",
    ].join("\n");
    const tableRows = [{
      rowRef: "40",
      fromFunction: "action_to_traj",
      controlAction: "Transform action",
      toFunction: "is_within_bounds",
      codeEvidence: {
        files: [{
          filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py",
          content,
          sourceFunctions: [
            { functionName: "action_to_traj", filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py", startLine: 1, endLine: 4 },
            { functionName: "is_within_bounds", filePath: "src/alpamayo1_5/action_space/unicycle_accel_curvature.py", startLine: 6, endLine: 7 },
          ],
        }],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Code-supported");
    expect(row.Confidence).toBe("High");
    expect(row["Code Relationship Audit"]).toMatch(/direct call evidence/i);
  });

  it("flags reversed architecture edges from indexed source content", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
        "Safety Significant",
        "Safety Significance Rationale",
      ], [
        "49",
        "construct_DTD",
        "Provide matrix",
        "dxy_theta_to_v",
        "If construct_DTD provides an incorrect matrix to dxy_theta_to_v, the velocity estimate may be wrong.",
        "Yes",
        "Generated hazard was initially marked safety significant.",
      ]],
    };
    const content = [
      "def dxy_theta_to_v(dxy):",
      "    matrix = construct_DTD(dxy)",
      "    return matrix",
      "",
      "def construct_DTD(dxy):",
      "    return dxy",
    ].join("\n");
    const tableRows = [{
      rowRef: "49",
      fromFunction: "construct_DTD",
      controlAction: "Provide matrix",
      toFunction: "dxy_theta_to_v",
      codeEvidence: {
        files: [{
          filePath: "src/alpamayo1_5/action_space/utils.py",
          content,
          sourceFunctions: [
            { functionName: "dxy_theta_to_v", filePath: "src/alpamayo1_5/action_space/utils.py", startLine: 1, endLine: 3 },
            { functionName: "construct_DTD", filePath: "src/alpamayo1_5/action_space/utils.py", startLine: 5, endLine: 6 },
          ],
        }],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Contradicted by code relationship");
    expect(row.Confidence).toBe("Low");
    expect(row["Code Relationship Audit"]).toMatch(/reverse call evidence/i);
    expect(row["Safety Significant"]).toBe("Needs Review");
    expect(row["Safety Significance Rationale"]).toMatch(/did not support the claimed architecture edge/i);
  });

  it("flags sibling functions that share a common caller instead of a direct edge", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "48",
        "unwrap_angle",
        "Normalize angle",
        "solve_single_constraint",
        "If unwrap_angle passes incorrect data to solve_single_constraint, trajectory smoothing may be wrong.",
      ]],
    };
    const content = [
      "def theta_smooth(theta):",
      "    angle = unwrap_angle(theta)",
      "    return solve_single_constraint(angle)",
      "",
      "def unwrap_angle(theta):",
      "    return theta",
      "",
      "def solve_single_constraint(theta):",
      "    return theta",
    ].join("\n");
    const tableRows = [{
      rowRef: "48",
      fromFunction: "unwrap_angle",
      controlAction: "Normalize angle",
      toFunction: "solve_single_constraint",
      codeEvidence: {
        files: [{
          filePath: "src/alpamayo1_5/action_space/utils.py",
          content,
          sourceFunctions: [
            { functionName: "theta_smooth", filePath: "src/alpamayo1_5/action_space/utils.py", startLine: 1, endLine: 3 },
            { functionName: "unwrap_angle", filePath: "src/alpamayo1_5/action_space/utils.py", startLine: 5, endLine: 6 },
            { functionName: "solve_single_constraint", filePath: "src/alpamayo1_5/action_space/utils.py", startLine: 8, endLine: 9 },
          ],
        }],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Contradicted by code relationship");
    expect(row.Confidence).toBe("Low");
    expect(row["Code Relationship Audit"]).toMatch(/sibling calls/i);
  });

  it("does not imply body-level verification when only symbols are available", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "30",
        "traj_to_action",
        "Transform trajectory",
        "action_to_traj",
        "Sampled actions may be converted into predicted trajectories without evidence that available acceleration and curvature bounds are enforced on the sampled output path.",
      ]],
    };
    const tableRows = [{
      rowRef: "30",
      fromFunction: "traj_to_action",
      controlAction: "Transform trajectory",
      toFunction: "action_to_traj",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "traj_to_action", filePath: "src/alpamayo1_5/action_space.py", startLine: 1, endLine: 1 },
          { functionName: "action_to_traj", filePath: "src/alpamayo1_5/action_space.py", startLine: 2, endLine: 2 },
          { functionName: "is_within_bounds", filePath: "src/alpamayo1_5/action_space.py", startLine: 3, endLine: 3 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Symbol-supported, edge unverified");
    expect(row["Code Relationship Audit"]).toMatch(/source bodies were not available/i);
    expect(row.Confidence).toBe("Medium");
  });

  it("rewrites invalid token propagation when code evidence shows clamping", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "81",
        "decode",
        "Decode token indices",
        "get_yaw_rotation_matrices",
        "If decode produces incorrect token indices, get_yaw_rotation_matrices may generate invalid matrices, causing navigation errors.",
      ]],
    };
    const tableRows = [{
      rowRef: "81",
      fromFunction: "decode",
      controlAction: "Decode token indices",
      toFunction: "get_yaw_rotation_matrices",
      codeEvidence: {
        files: [{
          filePath: "src/alpamayo1_5/models/token_utils.py",
          sourceFunctions: [{ functionName: "extract_traj_tokens", filePath: "src/alpamayo1_5/models/token_utils.py", startLine: 29 }],
          content: "invalid_tokens = (token_values < 0) | (token_values > traj_tokenizer_vocab_size)\ntoken_values = torch.clamp(token_values, min=0, max=traj_tokenizer_vocab_size - 1)",
        }],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Contradicted or mitigated by code");
    expect(row.Hazards).toMatch(/clamped into the accepted range/i);
    expect(row["Mitigation Evidence"]).toMatch(/Clamping mitigates raw invalid-token propagation/i);
  });

  it("marks navigation freshness hazards as edge-unverified when source bodies are unavailable", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "11",
        "compare_nav_conditions",
        "Call model.sample_trajectories_from_data_with_vlm_rollout",
        "_run_nav",
        "If model.sample_trajectories_from_data_with_vlm_rollout is called with incorrect navigation conditions, it may generate invalid trajectories, resulting in potential collision or off-course travel.",
      ]],
    };
    const tableRows = [{
      rowRef: "11",
      fromFunction: "compare_nav_conditions",
      controlAction: "Call model.sample_trajectories_from_data_with_vlm_rollout",
      toFunction: "_run_nav",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "compare_nav_conditions", filePath: "src/alpamayo1_5/nav_utils.py", startLine: 69 },
          { functionName: "_run_nav", filePath: "src/alpamayo1_5/nav_utils.py", startLine: 167 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Symbol-supported, edge unverified");
    expect(row["Safety Concern Type"]).toBe("Safety-critical");
    expect(row.Hazards).toMatch(/without evidence.*fresh/i);
    expect(row["Code Relationship Audit"]).toMatch(/endpoint symbols are present/i);
    expect(row["Recommended Verification"]).toMatch(/stale, missing, contradictory/i);
    expect(row["Recommended Mitigation"]).toMatch(/navigation freshness/i);
  });

  it("downgrades generic helper message hazards to data integrity or reliability concerns", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
        "Safety Significant",
        "Safety Significance Rationale",
      ], [
        "3",
        "_build_image_content",
        "Return constructed list",
        "create_message",
        "If the constructed list returned by _build_image_content contains malformed data, create_message may generate messages with incorrect content, leading to failures in communication protocols with downstream systems.",
        "Yes",
        "Generated hazard was initially marked safety significant.",
      ]],
    };
    const tableRows = [{
      rowRef: "3",
      fromFunction: "_build_image_content",
      controlAction: "Return constructed list",
      toFunction: "create_message",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "_build_image_content", filePath: "src/alpamayo1_5/helper.py", startLine: 38 },
          { functionName: "create_message", filePath: "src/alpamayo1_5/helper.py", startLine: 77 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Generic/low confidence");
    expect(row["Safety Concern Type"]).toBe("Data integrity");
    expect(row.Hazards).toMatch(/better treated as a data integrity concern/i);
    expect(row["Safety Significant"]).toBe("Needs Review");
    expect(row["Recommended Mitigation"]).toMatch(/schema validation/i);
    expect(row["Recommended Mitigation"]).not.toMatch(/navigation freshness|sampled actions/i);
  });

  it("marks generic configuration initialization hazards as low-confidence reliability concerns", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
        "Safety Significant",
        "Safety Significance Rationale",
      ], [
        "3",
        "__init__",
        "Store configuration",
        "ReasoningVLAConfig",
        "Storing configuration data improperly in ReasoningVLAConfig can lead to incorrect model initialization, affecting the system's ability to perform reasoning tasks accurately.",
        "Yes",
        "Generated hazard was initially marked safety significant.",
      ]],
    };
    const tableRows = [{
      rowRef: "3",
      fromFunction: "__init__",
      controlAction: "Store configuration",
      toFunction: "ReasoningVLAConfig",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "__init__", filePath: "src/alpamayo1_5/config.py", startLine: 12 },
          { functionName: "ReasoningVLAConfig", filePath: "src/alpamayo1_5/config.py", startLine: 4 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Generic/low confidence");
    expect(row["Safety Concern Type"]).toBe("Mission/reliability");
    expect(row.Confidence).toBe("Low");
    expect(row.Hazards).toMatch(/better treated as a mission\/reliability concern/i);
    expect(row["Safety Significant"]).toBe("Needs Review");
    expect(row["Recommended Mitigation"]).not.toMatch(/navigation freshness|sampled actions|trajectory token/i);
  });

  it("does not apply nav freshness guidance to helper image-content rows that mention route generically", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "7",
        "_build_image_content",
        "Build image message content",
        "create_message",
        "Malformed route image message content may cause downstream communication errors.",
      ]],
    };
    const tableRows = [{
      rowRef: "7",
      fromFunction: "_build_image_content",
      controlAction: "Build image message content",
      toFunction: "create_message",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "_build_image_content", filePath: "src/alpamayo1_5/helper.py", startLine: 38 },
          { functionName: "create_message", filePath: "src/alpamayo1_5/helper.py", startLine: 77 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Recommended Mitigation"]).not.toMatch(/navigation freshness/i);
    expect(row["Recommended Verification"]).not.toMatch(/stale, missing, contradictory/i);
  });

  it("does not apply nav freshness guidance to helper-only rows that mention nav_text", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "8",
        "create_vqa_message",
        "Build VQA message",
        "to_device",
        "Malformed nav_text in a helper message may cause generic message handling errors.",
      ]],
    };
    const tableRows = [{
      rowRef: "8",
      fromFunction: "create_vqa_message",
      controlAction: "Build VQA message",
      toFunction: "to_device",
      codeEvidence: {
        files: [{
          filePath: "src/alpamayo1_5/helper.py",
          content: "def create_vqa_message(nav_text):\n    return {'text': nav_text}\n\ndef to_device(x):\n    return x",
          sourceFunctions: [
            { functionName: "create_vqa_message", filePath: "src/alpamayo1_5/helper.py", startLine: 1, endLine: 2 },
            { functionName: "to_device", filePath: "src/alpamayo1_5/helper.py", startLine: 4, endLine: 5 },
          ],
        }],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Recommended Mitigation"]).not.toMatch(/navigation freshness/i);
    expect(row["Recommended Verification"]).not.toMatch(/stale, missing, contradictory/i);
  });

  it("keeps nav freshness guidance for helper calls grounded in the nav_utils chain", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "18",
        "_run_nav",
        "Build navigation-conditioned message",
        "create_vqa_message",
        "If navigation conditions are stale, the helper message may condition inference on the wrong route.",
      ]],
    };
    const tableRows = [{
      rowRef: "18",
      fromFunction: "_run_nav",
      controlAction: "Build navigation-conditioned message",
      toFunction: "create_vqa_message",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "_run_nav", filePath: "src/alpamayo1_5/nav_utils.py", startLine: 167 },
          { functionName: "create_vqa_message", filePath: "src/alpamayo1_5/helper.py", startLine: 102 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Recommended Mitigation"]).toMatch(/navigation freshness/i);
    expect(row["Recommended Verification"]).toMatch(/stale, missing, contradictory/i);
  });

  it("does not apply action-bounds guidance to base-model initialization and weight tying rows", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
        "Safety Significant",
        "Safety Significance Rationale",
      ], [
        "72",
        "__init__",
        "Initialize model",
        "_tie_weights",
        "Incorrect model initialization may degrade trajectory reasoning quality.",
        "Yes",
        "Generated hazard was initially marked safety significant.",
      ]],
    };
    const tableRows = [{
      rowRef: "72",
      fromFunction: "__init__",
      controlAction: "Initialize model",
      toFunction: "_tie_weights",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "__init__", filePath: "src/alpamayo1_5/models/base_model.py", startLine: 40 },
          { functionName: "_tie_weights", filePath: "src/alpamayo1_5/models/base_model.py", startLine: 95 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Recommended Mitigation"]).not.toMatch(/sampled actions|safety envelope/i);
    expect(row["Recommended Verification"]).not.toMatch(/out-of-bounds, NaN/i);
    expect(row["Safety Significant"]).toBe("Needs Review");
  });

  it("does not apply nav or action templates to visualization plotting rows", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "24",
        "plot_trajectory",
        "Render trajectory plot",
        "plt.plot",
        "Incorrect trajectory visualization may reduce operator awareness of route quality.",
      ]],
    };
    const tableRows = [{
      rowRef: "24",
      fromFunction: "plot_trajectory",
      controlAction: "Render trajectory plot",
      toFunction: "plt.plot",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "plot_trajectory", filePath: "src/alpamayo1_5/viz_utils.py", startLine: 12 },
          { functionName: "plt.plot", filePath: "src/alpamayo1_5/viz_utils.py", startLine: 20 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Safety Concern Type"]).toBe("Safety-critical");
    expect(row["Recommended Mitigation"]).not.toMatch(/navigation freshness|sampled actions|trajectory token/i);
    expect(row["Recommended Verification"]).not.toMatch(/stale, missing, contradictory|out-of-bounds, NaN/i);
  });

  it("downgrades symbol-supported unverified Yes rows to Needs Review", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
        "Safety Significant",
        "Safety Significance Rationale",
      ], [
        "51",
        "dxy_theta_to_v",
        "Provide velocity estimate",
        "theta_smooth",
        "Incorrect velocity smoothing may affect trajectory planning.",
        "Yes",
        "Generated hazard was initially marked safety significant.",
      ]],
    };
    const tableRows = [{
      rowRef: "51",
      fromFunction: "dxy_theta_to_v",
      controlAction: "Provide velocity estimate",
      toFunction: "theta_smooth",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "dxy_theta_to_v", filePath: "src/alpamayo1_5/action_space/utils.py", startLine: 70 },
          { functionName: "theta_smooth", filePath: "src/alpamayo1_5/action_space/utils.py", startLine: 120 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Symbol-supported, edge unverified");
    expect(row["Safety Significant"]).toBe("Needs Review");
    expect(row["Safety Significance Rationale"]).toMatch(/lacks verified caller\/callee evidence/i);
  });

  it("keeps generic safety-critical wording at low confidence until reviewed", () => {
    const sheets = {
      Summary: [[
        "Architecture Row Ref",
        "Function (From)",
        "Control Action",
        "Function (To)",
        "Hazards",
      ], [
        "61",
        "rot_3d_to_2d",
        "Return 2D rotation matrix",
        "torch.stack",
        "Returning an incorrect 2D rotation matrix due to incorrect input to rot_3d_to_2d can result in orientation errors in torch.stack, affecting navigation and control.",
      ]],
    };
    const tableRows = [{
      rowRef: "61",
      fromFunction: "rot_3d_to_2d",
      controlAction: "Return 2D rotation matrix",
      toFunction: "torch.stack",
      codeEvidence: {
        sourceFunctions: [
          { functionName: "rot_3d_to_2d", filePath: "src/alpamayo1_5/geometry.py", startLine: 41 },
          { functionName: "torch.stack", filePath: "src/alpamayo1_5/geometry.py", startLine: 45 },
        ],
      },
    }];

    const reviewed = ensureHazardSummaryEvidenceColumns(sheets, tableRows);
    const row = rowObject(reviewed.Summary);

    expect(row["Evidence Classification"]).toBe("Generic/low confidence");
    expect(row["Safety Concern Type"]).toBe("Safety-critical");
    expect(row.Confidence).toBe("Low");
  });
});
