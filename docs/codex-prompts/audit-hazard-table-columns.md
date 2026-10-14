# Audit code architecture hazard table columns

Read the implementation without changing production behavior. Determine whether
all 76 reported columns are required or used. Enumerate the actual current STPA,
HARA and FHA schemas and defaults; explain differences from saved/imported tables.
Trace fields through model generation, local assembly, validation, preprocessing,
diagram navigation, CSV import/export, and software-requirement derivation.
Distinguish visible results from necessary internal metadata, aliases, locally
calculated fields and legacy-only columns. Identify real gaps with source references;
do not equate a hidden or blank conditional field with unused data. Explain whether
hiding columns reduces model work. Recommend safe simplification without deleting
traceability or governed applicability. Produce an implementation audit report.
