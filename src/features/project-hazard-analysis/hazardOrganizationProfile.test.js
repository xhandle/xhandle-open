import { buildEffectiveOrganizationProfileContext, createOrganizationProfileRecord } from '../organization-profile/organizationProfile';
import { hazardOrganizationProfileProvenance, hazardRowMatchesOrganizationProfile } from './hazardOrganizationProfile';

const markdown = `---
organization: Profile regression fixture
profile_version: 1.0
status: approved
---
# Safety Philosophy
Preserve evidence-based injury outcomes.
# Custom Hazard Calibration
CUSTOM-CALIBRATION: apply the customer operational-frequency records.
`;
const calibration = (enabled = true, projectProfile) => ({
  context: buildEffectiveOrganizationProfileContext({
    profile: createOrganizationProfileRecord({ enabled, markdown }), projectProfile,
  }),
  profileId: 'profile-a', profileIdentity: 'profile-a-v1', profileUpdatedAt: '2026-11-16',
});
test('full hazard context retains custom sections and project overrides', () => {
  const current = calibration(true, { mode: 'inherit', overrideMarkdown: 'PROJECT-CALIBRATION: use the crossing frequency.' });
  expect(current.context).toContain('CUSTOM-CALIBRATION');
  expect(current.context).toContain('PROJECT-CALIBRATION');
  expect(hazardOrganizationProfileProvenance(current)).toMatchObject({ effectiveEnabled: true, profileId: 'profile-a' });
});
test.each([calibration(false), calibration(true, { mode: 'disabled' })])('disabled profiles have explicit uncalibrated provenance', current => {
  expect(current.context).toBe('');
  expect(hazardOrganizationProfileProvenance(current)).toMatchObject({ effectiveEnabled: false, profileId: null, profileIdentity: null, profileUpdatedAt: null });
});
test('reuses only rows generated with the same effective context', () => {
  const current = hazardOrganizationProfileProvenance(calibration());
  const record = { row: ['saved evidence'], organizationProfileProvenance: current };
  expect(hazardRowMatchesOrganizationProfile(record, current)).toBe(true);
  for (const changed of [calibration(false), calibration(true, {mode:'disabled'}), calibration(true, { mode:'inherit', overrideMarkdown:'Different project policy.' }), { ...calibration(), context: calibration().context.replace('customer operational-frequency', 'revised operational-frequency') }]) {
    expect(hazardRowMatchesOrganizationProfile(record, hazardOrganizationProfileProvenance(changed))).toBe(false);
  }
  expect(record.row).toEqual(['saved evidence']);
  expect(hazardRowMatchesOrganizationProfile({ generated:true }, current)).toBe(false);
});
test('a new disabled run cannot inherit enabled provenance and can reuse other disabled results', () => {
  const disabled = hazardOrganizationProfileProvenance(calibration(false));
  expect(hazardRowMatchesOrganizationProfile({organizationProfileProvenance: disabled}, disabled)).toBe(true);
  expect(hazardRowMatchesOrganizationProfile({organizationProfileProvenance: disabled}, hazardOrganizationProfileProvenance(calibration()))).toBe(false);
});
