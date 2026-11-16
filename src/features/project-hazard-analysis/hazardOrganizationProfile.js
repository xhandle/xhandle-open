import { organizationProfileContextIdentity } from '../organization-profile/organizationProfile';

// Store the effective context identity on each generated row. A project-wide
// timestamp cannot describe rows generated separately or in different scopes.
export function hazardOrganizationProfileProvenance(calibration = {}, appliedAt = new Date().toISOString()) {
  const context = calibration.context || '';
  return {
    artifact: 'hazard-analysis',
    effectiveEnabled: Boolean(context),
    effectiveContextIdentity: organizationProfileContextIdentity(context),
    profileId: context ? calibration.profileId || null : null,
    profileIdentity: context ? calibration.profileIdentity || null : null,
    profileUpdatedAt: context ? calibration.profileUpdatedAt || null : null,
    projectOverrideUpdatedAt: context ? calibration.projectOverrideUpdatedAt || null : null,
    appliedAt,
  };
}

export function hazardRowMatchesOrganizationProfile(record, currentProvenance) {
  const saved = record?.organizationProfileProvenance;
  // Legacy rows have no reliable calibration identity. Reassess once when the
  // user next runs analysis; continue displaying the saved evidence meanwhile.
  return Boolean(saved?.effectiveContextIdentity
    && saved.effectiveContextIdentity === currentProvenance?.effectiveContextIdentity
    && saved.effectiveEnabled === currentProvenance?.effectiveEnabled);
}
