jest.mock("./LiteSummaryDiagramReactFlowGitHub", () => function MockDiagram() {
  return null;
});
jest.mock("./ArchitectureReportViewer", () => function MockArchitectureReportViewer() {
  return null;
});
jest.mock("./FilterableTableHeader", () => ({
  FilterableHeaderCell: function MockFilterableHeaderCell() {
    return null;
  },
  useColumnFilters: () => ({
    filters: {},
    setFilter: jest.fn(),
    filteredRows: [],
  }),
}));
jest.mock("../features/results-review/ReviewStatusBadge", () => function MockReviewStatusBadge() {
  return null;
});
jest.mock("../features/code-architecture-assurance/codeArchitectureMetrics", () => ({
  createFunctionalDecompositionMetricsRun: jest.fn(),
  finishFunctionalDecompositionMetricsRun: jest.fn(),
  recordFunctionalDecompositionAiCall: jest.fn(),
  saveFunctionalDecompositionMetricsRun: jest.fn(),
}));

const {
  buildSourceFileIndexRecord,
  groundFunctionalDecompositionRow,
} = require("./generateFunctionalDecompositionFromGitHub");

function makeStats() {
  return {
    accepted: 0,
    rejected: 0,
    normalizedPathCount: 0,
    weakEvidenceCount: 0,
    duplicateRowCount: 0,
    rejectionReasons: {},
    rejectedRows: [],
  };
}

function exactRepoPathResolver() {
  return {
    resolve(path, currentPath) {
      const resolved = path || currentPath || "";
      return resolved
        ? { status: "exact", raw: path, path: resolved }
        : { status: "missing", raw: path, path: "" };
    },
  };
}

function groundPythonRow({ content, row, path = "src/example.py" }) {
  const stats = makeStats();
  const currentFileRecord = buildSourceFileIndexRecord({
    owner: "owner",
    repo: "repo",
    path,
    content,
    branch: "main",
    commitSha: "abc123",
  });
  const result = groundFunctionalDecompositionRow({
    row: {
      fromFile: path,
      toFile: path,
      fromDetails: "Source function from endpoint.",
      controlActionDetails: "Source relationship under review.",
      toDetails: "Source function to endpoint.",
      ...row,
    },
    currentFile: { path },
    currentFileRecord,
    repoPathResolver: exactRepoPathResolver(),
    stats,
    chunkIndex: 1,
  });
  return { result, stats, currentFileRecord };
}

describe("functional decomposition Python edge grounding", () => {
  it("rejects rotation-style sibling transforms with no internal calls", () => {
    const content = [
      "def so3_to_yaw_torch(rot):",
      "    return torch.atan2(rot[..., 1, 0], rot[..., 0, 0])",
      "",
      "def so3_to_yaw_np(rot):",
      "    return np.arctan2(rot[..., 1, 0], rot[..., 0, 0])",
      "",
      "def angle_wrap(radians):",
      "    return (radians + np.pi) % (2 * np.pi) - np.pi",
      "",
      "def round_2pi_torch(radians):",
      "    return torch.atan2(torch.sin(radians), torch.cos(radians))",
    ].join("\n");

    const first = groundPythonRow({
      content,
      row: {
        from: "so3_to_yaw_torch",
        action: "Call numpy yaw conversion",
        to: "so3_to_yaw_np",
      },
    });
    const second = groundPythonRow({
      content,
      row: {
        from: "round_2pi_torch",
        action: "Call angle wrapping",
        to: "angle_wrap",
      },
    });

    expect(first.result).toBeNull();
    expect(first.stats.rejectionReasons.unverified_same_file_python_relationship).toBe(1);
    expect(second.result).toBeNull();
    expect(second.stats.rejectionReasons.unverified_same_file_python_relationship).toBe(1);
  });

  it("keeps verified direct Python calls", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "def caller(value):",
        "    return callee(value)",
        "",
        "def callee(value):",
        "    return value",
      ].join("\n"),
      row: {
        from: "caller",
        action: "Call callee",
        to: "callee",
      },
    });

    expect(result).not.toBeNull();
    expect(result.grounding.relationshipType).toBe("direct_call");
    expect(stats.accepted).toBe(1);
  });

  it("rejects reversed Python call edges", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "def caller(value):",
        "    return callee(value)",
        "",
        "def callee(value):",
        "    return value",
      ].join("\n"),
      row: {
        from: "callee",
        action: "Call caller",
        to: "caller",
      },
    });

    expect(result).toBeNull();
    expect(stats.rejectionReasons.reversed_same_file_python_call).toBe(1);
  });

  it("rejects skipped-level Python edges when only an intermediate function is called", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "def first(value):",
        "    return second(value)",
        "",
        "def second(value):",
        "    return third(value)",
        "",
        "def third(value):",
        "    return value",
      ].join("\n"),
      row: {
        from: "first",
        action: "Call third",
        to: "third",
      },
    });

    expect(result).toBeNull();
    expect(stats.rejectionReasons.unverified_same_file_python_relationship).toBe(1);
  });

  it("does not treat a constructor as calling forward unless forward is actually called", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "class MLPEncoder:",
        "    def __init__(self):",
        "        self.layers = []",
        "",
        "    def forward(self, x):",
        "        return x",
      ].join("\n"),
      row: {
        from: "__init__",
        action: "Call forward",
        to: "forward",
      },
    });

    expect(result).toBeNull();
    expect(stats.rejectionReasons.unverified_same_file_python_relationship).toBe(1);
  });

  it("does not treat an abstract base class as instantiating its subclass", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "from abc import ABC, abstractmethod",
        "",
        "class ActionSpace(ABC):",
        "    @abstractmethod",
        "    def traj_to_action(self, traj):",
        "        raise NotImplementedError",
        "",
        "class UnicycleAccelCurvatureActionSpace(ActionSpace):",
        "    def traj_to_action(self, traj):",
        "        return traj",
      ].join("\n"),
      row: {
        from: "ActionSpace",
        action: "Instantiate ActionSpace",
        to: "UnicycleAccelCurvatureActionSpace",
      },
    });

    expect(result).toBeNull();
    expect(stats.rejectionReasons.reversed_same_file_python_inheritance).toBe(1);
  });

  it("keeps explicit inheritance relationships when the row says it is inheritance", () => {
    const { result } = groundPythonRow({
      content: [
        "class ActionSpace:",
        "    pass",
        "",
        "class UnicycleAccelCurvatureActionSpace(ActionSpace):",
        "    pass",
      ].join("\n"),
      row: {
        from: "UnicycleAccelCurvatureActionSpace",
        action: "Inherit from base class",
        controlActionDetails: "Subclass extends the base class.",
        to: "ActionSpace",
      },
    });

    expect(result).not.toBeNull();
    expect(result.grounding.relationshipType).toBe("inheritance");
  });

  it("keeps class-to-method rows as structural membership instead of direct calls", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "class ActionSpace:",
        "    def get_action_space_dims(self):",
        "        return 3",
      ].join("\n"),
      row: {
        from: "ActionSpace",
        action: "Call get_action_space_dims",
        to: "get_action_space_dims",
      },
    });

    expect(result).not.toBeNull();
    expect(result.action).toBe("Define get_action_space_dims");
    expect(result.grounding.relationshipType).toBe("structural_member");
    expect(stats.accepted).toBe(1);
  });

  it("rejects instance-attribute pseudo-targets that are not callable endpoints", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "class MLPEncoder:",
        "    def __init__(self):",
        "        self.trunk = []",
        "",
        "    def forward(self, x):",
        "        return self.trunk(x)",
        "",
        "class PerWaypointActionInProjV2:",
        "    def __init__(self):",
        "        self.encoder = MLPEncoder()",
      ].join("\n"),
      row: {
        from: "MLPEncoder",
        action: "Call",
        to: "encoder",
      },
    });

    expect(result).toBeNull();
    expect(stats.rejectionReasons.current_file_symbol_mismatch).toBe(1);
  });

  it("rejects class-level helper rows when only a non-constructor method calls the helper", () => {
    const content = [
      "class DeltaTrajectoryTokenizer:",
      "    def __init__(self):",
      "        self.num_bins = 1000",
      "",
      "    def encode(self, value):",
      "        return value",
      "",
      "    def decode(self, tokens):",
      "        return get_yaw_rotation_matrices(tokens)",
      "",
      "def get_yaw_rotation_matrices(tokens):",
      "    return tokens",
    ].join("\n");
    const initRow = groundPythonRow({
      content,
      row: {
        from: "DeltaTrajectoryTokenizer",
        action: "Initialize tokenizer",
        to: "get_yaw_rotation_matrices",
      },
    });
    const encodeRow = groundPythonRow({
      content,
      row: {
        from: "DeltaTrajectoryTokenizer",
        action: "Encode trajectories",
        to: "get_yaw_rotation_matrices",
      },
    });

    expect(initRow.result).toBeNull();
    expect(initRow.stats.rejectionReasons.unverified_class_level_python_relationship).toBe(1);
    expect(encodeRow.result).toBeNull();
    expect(encodeRow.stats.rejectionReasons.unverified_class_level_python_relationship).toBe(1);
  });

  it("keeps method-level helper calls such as decode to get_yaw_rotation_matrices", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "class DeltaTrajectoryTokenizer:",
        "    def decode(self, tokens):",
        "        return get_yaw_rotation_matrices(tokens)",
        "",
        "def get_yaw_rotation_matrices(tokens):",
        "    return tokens",
      ].join("\n"),
      row: {
        from: "decode",
        action: "Decode tokens",
        to: "get_yaw_rotation_matrices",
      },
    });

    expect(result).not.toBeNull();
    expect(result.grounding.relationshipType).toBe("direct_call");
    expect(stats.accepted).toBe(1);
  });

  it("normalizes extract_traj_tokens incidental tensor rows to the safety-relevant torch.clamp call", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "import torch",
        "",
        "def extract_traj_tokens(output_tokens, traj_tokenizer_vocab_size):",
        "    valid_mask = output_tokens > 0",
        "    extracted_tokens = torch.where(valid_mask, output_tokens, torch.zeros_like(output_tokens))",
        "    token_values = extracted_tokens - 1",
        "    invalid_tokens = (token_values < 0) | (token_values > traj_tokenizer_vocab_size)",
        "    if invalid_tokens.any():",
        "        logger.warning('Invalid token ids found')",
        "    token_values = torch.clamp(token_values, min=0, max=traj_tokenizer_vocab_size - 1)",
        "    return token_values",
      ].join("\n"),
      row: {
        from: "extract_traj_tokens",
        action: "Log warnings",
        to: "torch.where",
      },
    });

    expect(result).not.toBeNull();
    expect(result.to).toBe("torch.clamp");
    expect(result.action).toBe("Clamp trajectory token ids");
    expect(result.controlActionDetails).toMatch(/clamped rather than rejected/i);
    expect(stats.accepted).toBe(1);
  });

  it("aligns primitive call action text with the actual target endpoint", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "import torch",
        "",
        "def replace_padding_after_eos(values):",
        "    return torch.arange(values.shape[0])",
      ].join("\n"),
      row: {
        from: "replace_padding_after_eos",
        action: "Call `torch.where`",
        to: "torch.arange",
      },
    });

    expect(result).not.toBeNull();
    expect(result.action).toBe("Call torch.arange");
    expect(stats.accepted).toBe(1);
  });

  it("rejects reversed Python inheritance even when both classes are concrete", () => {
    const { result, stats } = groundPythonRow({
      content: [
        "class ActionSpace:",
        "    pass",
        "",
        "class UnicycleAccelCurvatureActionSpace(ActionSpace):",
        "    pass",
      ].join("\n"),
      row: {
        from: "ActionSpace",
        action: "Import subclass",
        to: "UnicycleAccelCurvatureActionSpace",
      },
    });

    expect(result).toBeNull();
    expect(stats.rejectionReasons.reversed_same_file_python_inheritance).toBe(1);
  });

  it("rejects rows whose endpoints do not touch the current source file", () => {
    const stats = makeStats();
    const content = [
      "def main():",
      "    load_data()",
      "    create_message()",
    ].join("\n");
    const currentFileRecord = buildSourceFileIndexRecord({
      owner: "owner",
      repo: "repo",
      path: "src/current.py",
      content,
      branch: "main",
      commitSha: "abc123",
    });
    const result = groundFunctionalDecompositionRow({
      row: {
        from: "load_data",
        fromFile: "src/data.py",
        fromDetails: "First sibling call.",
        action: "Prepare messages",
        controlActionDetails: "Sibling functions are called by main.",
        to: "create_message",
        toFile: "src/helper.py",
        toDetails: "Second sibling call.",
      },
      currentFile: { path: "src/current.py" },
      currentFileRecord,
      repoPathResolver: exactRepoPathResolver(),
      stats,
      chunkIndex: 1,
    });

    expect(result).toBeNull();
    expect(stats.rejectionReasons.row_not_grounded_in_current_file).toBe(1);
  });

  it("rejects reversed current-file calls for cross-file rows", () => {
    const stats = makeStats();
    const content = [
      "def get_processor(tokenizer):",
      "    return AutoProcessor.from_pretrained('model')",
    ].join("\n");
    const currentFileRecord = buildSourceFileIndexRecord({
      owner: "owner",
      repo: "repo",
      path: "src/helper.py",
      content,
      branch: "main",
      commitSha: "abc123",
    });
    const result = groundFunctionalDecompositionRow({
      row: {
        from: "AutoProcessor.from_pretrained",
        fromFile: "src/model.py",
        fromDetails: "Framework factory call.",
        action: "Initialize processor",
        controlActionDetails: "Generated edge is reversed.",
        to: "get_processor",
        toFile: "src/helper.py",
        toDetails: "Helper function that performs the call.",
      },
      currentFile: { path: "src/helper.py" },
      currentFileRecord,
      repoPathResolver: exactRepoPathResolver(),
      stats,
      chunkIndex: 1,
    });

    expect(result).toBeNull();
    expect(stats.rejectionReasons.reversed_current_file_python_call).toBe(1);
  });

  it("keeps qualified Python calls such as self.foo and module.foo", () => {
    const selfCall = groundPythonRow({
      content: [
        "def caller(self, value):",
        "    return self.foo(value)",
        "",
        "def foo(value):",
        "    return value",
      ].join("\n"),
      row: {
        from: "caller",
        action: "Call foo",
        to: "foo",
      },
    });
    const moduleCall = groundPythonRow({
      content: [
        "def caller(value):",
        "    return helpers.foo(value)",
        "",
        "def foo(value):",
        "    return value",
      ].join("\n"),
      row: {
        from: "caller",
        action: "Call foo",
        to: "foo",
      },
    });

    expect(selfCall.result).not.toBeNull();
    expect(selfCall.result.grounding.relationshipType).toBe("direct_call");
    expect(moduleCall.result).not.toBeNull();
    expect(moduleCall.result.grounding.relationshipType).toBe("direct_call");
  });
});
