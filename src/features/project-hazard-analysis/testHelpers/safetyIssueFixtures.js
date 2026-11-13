export function fixtureSafetyIssues({ families }) {
  return families.map(family => {
    const cells = family.rows[0]?.cells || {};
    return {
      title: cells['Safety Issue Title'] || `Failure of ${cells['Control Action'] || cells['Function (From)'] || cells.Hazard || family.familyId}`.slice(0, 105),
      description: cells['Engineering Concern'] || 'Recorded unsafe control behavior requires a coherent engineering response based on the linked hazard evidence.',
      sourceFamilyIds: [family.familyId], likelihood: 3, severity: 3,
    };
  });
}
