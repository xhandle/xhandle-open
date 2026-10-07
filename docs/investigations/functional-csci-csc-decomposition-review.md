# Functional CSCI/CSC decomposition review

Date: 2026-10-07. Scope: read-only engineering review; no application or supplied CSV changes, no paid analysis calls.

## Conclusion

There are two distinct problems: the Functional table/export does not expose architecture allocations at all, and Functional generation does not create a new CSCI/CSC decomposition. It inherits upstream allocations, which can be coarse directory-based fallbacks. The diagram renderer does retain CSCI and CSC containers; its deliberate flattening removes only the redundant CSU container.

The supplied CSV proves the table/export omission. It cannot establish which upstream allocation path this particular run used, or whether its saved model has one or several CSCI/CSC groups.

## Supplied evidence

`/Users/Nick/Downloads/SasanLabs-VulnerableApp-functional-view-2026-10-07.csv` contains 311 rows, 192 distinct function labels across endpoints, and 329 distinct supporting trace IDs. Every row has supporting trace IDs. Its nine columns describe interaction type, source function/details, control action/details, destination function/details, supporting row numbers and supporting trace IDs. There are no subsystem, CSCI, CSC, CSU, endpoint allocation or file-path columns.

Interaction labels: 136 unknown, 59 Internal operations, 32 control, 47 data, 25 service and 12 feedback. These counts describe the export, not the number of upstream classifier inputs or saved architecture components.

## Findings

### 1. Confirmed: hierarchy is omitted from both Functional table and CSV

`src/components/FunctionalArchitectureDiagram.jsx:53` defines function/action columns; `:58` defines CSV columns, and `:86` defines table columns. None includes architecture allocations. Therefore even a correctly decomposed saved model exports without CSCI/CSC information. This is a presentation/export omission, not proof that generation lost those fields.

Derived rows already have `architecture`, `fromArchitecture` and `toArchitecture` in `src/features/code-architecture-context/functionalModel.js:415`. Displaying endpoint-specific allocations would make the hierarchy inspectable without changing current functional responsibilities or interactions.

### 2. Confirmed: upstream classification can bypass semantic CSCI/CSC allocation

`src/components/generateFunctionalDecompositionFromGitHub.js:2903` excludes canonical relationships from the nested allocation request. At `:2914`, canonical relationships always use `inferArchitectureFallback`. Separately, `generateNestedArchitectureAllocationPlan` at `:2479` returns no plan when its input exceeds `MAX_AI_ARCHITECTURE_ALLOCATION_ROWS` (300, declared at `:385`), or when credentials/input are absent. Missing allocations also fall back.

The fallback at `:2353` chooses CSCI from the first meaningful directory segment and CSC from the second. Functions in different deeper packages can consequently share the same coarse CSCI/CSC. Component description generation does not introduce additional allocations. Refinement at `:2370` normalizes names using the same fallback rather than discovering functional component boundaries.

The directory helper at `:2319` concatenates directory segments from both endpoints without deduplication. For shallow paths, the selected second segment can even come from another endpoint or repeat the first directory. Directory heuristics do not establish software configuration-item boundaries.

Both GitHub and local acquisition feed this shared classification path (source selection around `:2975`, classification around `:3423`). These risks are not limited to one repository or pipeline. The CSV's 311 derived rows must not be used to claim that the 300-input threshold triggered on this run: the counts represent different processing stages.

### 3. Confirmed: Functional processing inherits coarse allocations and can misassign destination ownership

`src/features/code-architecture-context/functionalModel.js:119` builds function owners using the first source row's `architecture`. It does not reconcile differing allocations or prefer an explicit `fromArchitecture`. The generation response schema at `:146` requests functional responsibilities and relationships, not new CSCI/CSC groups. At `:159`, the generated function receives the inherited owner architecture.

At `:181` and `:195`, targets without an owner entry inherit the caller's architecture, even if a source row provides destination-specific allocation. Destination-only functions or external interfaces can consequently appear inside the caller's component. This is a code-path risk; this CSV does not reveal whether it occurred here.

Consolidation at `:246` scopes by existing subsystem/CSCI/CSC allocations, and its prompt at `:272` explicitly operates within one component. It can consolidate functional responsibilities but cannot repair coarse CSCI/CSC decomposition. Derived rows at `:415` preserve these inherited assignments.

### 4. Confirmed: the renderer is not globally removing CSCI/CSC

`src/components/LiteSummaryDiagramReactFlowGitHub.js:660` builds the nested hierarchy. CSCI and CSC boxes are created at `:786` and `:806`. Only CSU box creation is conditional on non-Functional presentation (`:826`); Functional function nodes are parented directly to CSC (`:862`). Restoring redundant CSU wrappers would not resolve missing CSCI/CSC decomposition.

## Validation and limitations

Ran existing regression suites for `generateFunctionalDecompositionFromGitHub.test.js`, `functionalModel.test.js`, and `FunctionalArchitectureDiagram.test.jsx`: **3 suites, 77 tests passed**. These establish that existing tested behavior remains intact; they do not establish the semantic quality of CSCI/CSC allocation. No production build was necessary for this documentation-only review.

To attribute the supplied run precisely, inspect its saved detailed rows/workbook containing source and destination file paths, canonical relationship IDs, architecture allocations and allocation rationale, together with saved Functional descriptors and the number of noncanonical classifier inputs. Those fields are not in this CSV. No actual customer browser state or live repository analysis was accessed.

## Bounded remediation proposal

1. Expose subsystem/CSCI/CSC allocations in the Functional table and CSV, distinguishing source and destination ownership. Preserve existing function/action links, filters, split behavior and supporting trace IDs.
2. Introduce a scalable component allocation stage based on evidence-backed responsibilities and configuration boundaries, applicable to both canonical and model-extracted relationships. Avoid the current all-or-nothing 300-row semantic-allocation bypass through bounded component batches and reconciliation. Do not force a minimum number of CSCI/CSC groups or equate directories with configuration items.
3. Establish consistent endpoint ownership before Functional generation. Prefer explicit endpoint allocations; resolve conflicting evidence explicitly and avoid assigning destination-only/external endpoints to a caller merely because they lack outgoing rows.
4. Preserve current function abstraction, source relationship identities, coverage and supporting traceability. Treat regrouping as allocation metadata; inspect downstream consumers before changing hierarchy keys. Version affected derived caches/layouts and retain saved analyses and user assessments rather than silently replacing them.
5. Validate with repositories containing multiple real components under shared directory prefixes, shallow paths, canonical and model-extracted calls, more than 300 classifier inputs, destination-only functions and external targets. Check GitHub/local equivalence, persisted reloads, table/CSV/diagram allocation agreement, and downstream hazard/requirements/design/traceability mappings.

No implementation was performed as part of this review.
