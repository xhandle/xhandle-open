# Hazard table column audit

## Conclusion

No: all columns do not need to be visible, and they are not all separately generated
assessments. The current compact generator emits 73 STPA, 69 HARA and 68 FHA unique
Summary headers; the default visible sets contain 13, 14 and 15 respectively.
Counts were calculated from the method defaults, common fields, method extras and
traceability columns that fastHazardSheets unions. A saved/imported table supplies
its own headers to the picker, so a reported 76 is not proof of the old pipeline.
The exact user's 76-header table was not supplied for this audit.

## Findings and safe simplification

1. **The picker exposes storage structure.** CodeArchitectureHazardSummaryTable.js
   builds columnOptions from every saved header (around lines 123–162). Defaults hide
   fields but do not remove them from the picker. FHA additionally adds missing
   default columns for historical sheets, potentially blank. Separate analysis
   columns from optional provenance/diagnostic columns in the UI; retain stored data.
2. **Aliases add width without new reasoning.** STPA/HARA Function duplicates Function
   (From); Assessed Control Action repeats Control Action but is checked against it.
   HARA Hazard mirrors Hazardous Event; FHA Hazard mirrors Mishap. Keep compatibility
   fields internally until their consumers are migrated; no need to display both.
3. **Traceability is actively used.** Trace/node/edge IDs support diagram navigation;
   source references and architecture allocation feed derived requirement traceability.
   Provenance is also reconstructed by readSourceTrace in codeArchitectureHazardUtils.js.
   These are poor candidates for deletion merely because users do not read them.
4. **Reasoning metadata has a purpose.** Execution/operator dependencies, causal basis
   and evidence quotes are consumed by validateMergedSheet/validateFastAssessment.
   Empty dependency quotes are intentional when no such dependency is asserted.
   Local/GitHub-specific provenance may also be empty by design.
5. **Legacy fields are not all generated now.** Protection Assessment/Status,
   Physical-Harm Chain Termination, Classification Confidence, Proposed Safety
   Assessment and older audit columns belong to older standard/evidence schemas.
   Their presence in a saved/exported table does not cause the compact generator to
   populate them. Preserve historical values; do not offer them as new compact
   assessment outputs without implementing those outputs.
6. **SW requirements use a subset, not all columns.** artifactAI.js
   hazardSafetyRequirementRows reads applicability and Safety Significant gates,
   Software Safety Requirement, Hazard (with aliases), Safety Constraint/Goal,
   Verification, severity/ASIL/SWCI, function/action, context, and architecture/source
   references. STPA's new Loss/UCA IDs and relationship columns are retained for
   human/export traceability; this consumer still links by hazard row HZ-xxx and
   source Trace ID, not a canonical Loss–Hazard–UCA catalog.
7. **CSV differs from visible copy.** The hazard toolbar exports filtered rows with
   all original columns: onVisibleSummaryChange supplies the complete header/rows.
   CopyTableButton uses visible columns. Hiding columns does not shrink this CSV.
   Any future concise export should coexist with a full round-trip export.

## Generation cost

The current STPA prompt requests 5 common response fields, 8 STPA-specific fields,
8 action/evidence/dependency fields, and the row ID (22 JSON fields total for an
applicable row). The 73 table columns are not 73 independent AI tasks. Most context,
source metadata and IDs are copied or assembled locally. HARA ASIL and FHA SWCI
are calculated locally. Merely hiding columns will not speed model generation;
reducing generated narrative or repeated prompt evidence would, with quality tradeoffs.
No extra analysis pass exists for each metadata column.

## Recommended scope

Keep the 13 current STPA analysis defaults; retain supporting data internally and
make optional rationale/requirements/traceability accessible through clearly grouped
column choices or row details. Avoid global deletion: it can break CSV round trips,
reviewed-input matching, diagram navigation and SW requirements. Label legacy-only
fields on historical records instead of pretending the new generator fills them.
No production changes were made in this audit.

## Current STPA column inventory

The following is the exact assembled header order. Generated core/rationale text
comes from the model; context/architecture/provenance come from the source snapshot;
IDs, relationships and Safety Significant are assigned locally. Dependency and
causal fields are validation inputs as well as supporting output. All headers are
retained by full CSV export and generic table handling, even where no dedicated
calculation reads them.
1. Function
2. Operational Scenario
3. Operational Mode
4. Operating Conditions
5. Guide Phrase
6. Guide Phrase Applicable
7. Unsafe Control Action
8. Loss
9. Hazard
10. Causal Scenario
11. Safety Constraint
12. Verification
13. Safety Classification
14. Execution Dependency
15. Execution Evidence Quote
16. Operator Dependency
17. Operator Context Quote
18. Function (From)
19. Control Action
20. Function (To)
21. Operational Context ID
22. Context Assumptions
23. Guide Phrase Applicability Rationale
24. Guide Phrase Applicability Review Status
25. Safety Significant
26. Safety Significance Rationale
27. Software Safety Requirement
28. Assumptions
29. Assessment Basis
30. Assessed Control Action
31. Causal Assessment Basis
32. Causal Evidence / Assumption
33. Causal Evidence Quote
34. Raw Analysis Row ID
35. Causal Factor
36. Loss ID
37. Hazard ID
38. UCA ID
39. Hazard → Loss ID
40. UCA → Hazard ID
41. Causal Scenario → UCA ID
42. Safety Constraint → UCA ID
43. Trace ID
44. From Node ID
45. Control Edge ID
46. To Node ID
47. Architecture Row Ref
48. Architecture Element ID
49. Related Source File(s)
50. Source Symbols
51. Source Line Ranges
52. Subsystem
53. CSCI
54. CSC
55. CSU
56. Lifecycle Phase
57. Interface Type
58. Hazard Analysis Eligibility
59. Eligibility Rationale
60. Eligibility Source
61. Evidence Source Type
62. Evidence Snapshot ID
63. Evidence Version
64. Local Source ID
65. Local Folder Name
66. Evidence Repository ID
67. Architecture Lineage Status
68. Architecture Run Fingerprint
69. Architecture Scope
70. Classification Policy Version
71. Functional Source Trace IDs
72. Functional Source Row Refs
73. Functional Interaction Kind