// Keep the recovery role independent of journal modules, SQLite, credentials and application work.
if (process.argv.includes('--gitorian-recovery') && process.env.GITORIAN_RECOVERY_PROFILE) {
    void import('./recovery-dialog').then(({ showRecoveryDialog }) =>
        showRecoveryDialog(process.env.GITORIAN_RECOVERY_PROFILE!)
    )
} else {
    void import('./desktop-main')
}
