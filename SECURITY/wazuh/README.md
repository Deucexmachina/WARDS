# Wazuh local configuration

`ossec.conf` is intentionally not tracked by git because it contains absolute
paths that are different on every developer machine.

Create or update `SECURITY/wazuh/ossec.conf` locally and point the monitored
directories to the absolute paths for your own checkout:

```xml
<ossec_config>
  <syscheck>
    <frequency>300</frequency>
    <scan_on_start>yes</scan_on_start>
    <alert_new_files>yes</alert_new_files>
    <directories check_all="yes" realtime="yes" report_changes="yes">C:\ABSOLUTE\PATH\TO\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS</directories>
    <directories check_all="yes" realtime="yes" report_changes="yes">C:\ABSOLUTE\PATH\TO\WARDS_MASTERFILE\WARDS MASTERFILE\OCR</directories>
    <directories check_all="yes" realtime="yes" report_changes="yes">C:\ABSOLUTE\PATH\TO\WARDS_MASTERFILE\WARDS MASTERFILE\SECURITY\database_monitor</directories>
    <ignore type="sregex">\\node_modules\\</ignore>
    <ignore type="sregex">\\venv\\</ignore>
    <ignore type="sregex">\\__pycache__\\</ignore>
    <ignore type="sregex">\\dist\\</ignore>
    <ignore type="sregex">\.(log|tmp|pyc|map)$</ignore>
  </syscheck>
</ossec_config>
```

Replace each `C:\ABSOLUTE\PATH\TO\...` value with the real absolute path on
your computer. Do not commit `ossec.conf`; only commit this README or other
shared Wazuh rules that do not contain machine-specific paths.

When monitored folders are added or removed from the WARDS admin UI on Windows,
the main application stays non-admin and uses the dedicated
`SECURITY/wazuh_admin_helper.py` process for Wazuh-only administrative work.

By default, the application edits `SECURITY/wazuh/ossec.conf`. If
`WAZUH_CONFIG_PATH` is set, that override is used instead.

Team-shared monitored folders that live inside the repository are stored in
`SECURITY/monitoring/monitored_folders.json` as repo-relative paths so they
survive Git push/pull and resolve correctly on each teammate's machine.

Optional environment variables:

- `WAZUH_CONFIG_PATH`
- `WAZUH_SERVICE_NAME`
- `WAZUH_SERVICE_RESTART_ENABLED`
