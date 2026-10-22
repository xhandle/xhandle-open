import { pauseBackupsForWorkspaceTransfer, getLocalBackupState, backupNow, restoreFromBackupFile, restoreFromConfiguredBackup } from './localBackupService';
test('full transfers pause folder/download backups and legacy restores until released',async()=>{
  const release=pauseBackupsForWorkspaceTransfer();
  expect(getLocalBackupState().busy).toBe(true);
  expect(()=>pauseBackupsForWorkspaceTransfer()).toThrow('progress');
  await expect(backupNow()).rejects.toThrow('transfer');
  await expect(backupNow({silentIfUnavailable:true})).resolves.toBeNull();
  await expect(restoreFromBackupFile({})).rejects.toThrow('transfer');
  await expect(restoreFromConfiguredBackup()).rejects.toThrow('transfer');
  release();expect(getLocalBackupState().busy).toBe(false);
});
