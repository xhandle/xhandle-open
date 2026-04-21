# Roadmap

## Near Term
- Remove compatibility path shims once all imports point to canonical locations
- Continue reducing cross-feature imports
- Tighten feature boundaries for traceability and hazard-analysis modules

## Mid Term
- Normalize API calling helpers into `src/lib/api`
- Consolidate local persistence adapters in `src/lib/storage`
- Split large feature files into smaller modules where safe

## Longer Term
- Introduce architectural lint rules for folder boundaries
- Add CI checks for build + import hygiene
- Document feature ownership and module contracts
