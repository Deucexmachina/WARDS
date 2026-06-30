import { useEffect, useMemo, useRef, useState } from 'react';
import { CustomSelect, CustomDatePicker } from '../../components/FormControls';
import { useNavigate } from 'react-router-dom';
import PublicBrandLogo from '../../components/PublicBrandLogo';
import api from '../../services/api';

const tabs = ['Dashboard', 'File Status', 'Backup History', 'Detection History', 'Recovery History', 'Security Incidents', 'Manual Controls'];
const severities = ['info', 'low', 'medium', 'high', 'critical'];
const sortOptions = [
  { value: 'newest', label: 'Newest to oldest' },
  { value: 'oldest', label: 'Oldest to newest' },
];
const sensitivityOptions = [
  { value: 0.5, label: 'Low', hint: 'Less strict' },
  { value: 1, label: 'Normal', hint: 'Recommended' },
  { value: 1.5, label: 'High', hint: 'More strict' },
];
const recoveryDomainLabels = {
  application_files: 'App Files',
  vm1_database: 'VM1 DB',
  vm2_database: 'VM2 DB',
  ai_ml_assets: 'ML',
};
const FILE_PAGE_SIZE = 10;
const buttonBase = 'inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const buttonStyles = {
  primary: `${buttonBase} bg-primary text-white hover:bg-blue-900 focus:ring-primary/40`,
  neutral: `${buttonBase} bg-slate-900 text-white hover:bg-slate-700 focus:ring-slate-400`,
  subtle: `${buttonBase} bg-slate-100 text-slate-800 hover:bg-slate-200 focus:ring-slate-300`,
  success: `${buttonBase} bg-green-600 text-white hover:bg-green-700 focus:ring-green-500/40`,
  warning: `${buttonBase} bg-amber-500 text-white hover:bg-amber-600 focus:ring-amber-500/40`,
  danger: `${buttonBase} bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/40`,
  info: `${buttonBase} bg-blue-50 text-primary hover:bg-blue-100 focus:ring-primary/30`,
};

const ruleHelp = {
  hour_of_day: 'Learns the normal time range for admin changes.',
  day_of_week: 'Learns which days usually contain legitimate admin activity.',
  session_duration: 'Checks whether the session age looks normal for the change.',
  file_size_change: 'Compares the byte difference against the clean backup copy.',
  content_length: 'Checks whether the new file length is unusual.',
  special_chars_count: 'Counts code-like or injection-friendly characters.',
  admin_session_valid: 'Checks whether a valid WARDS admin JWT/MFA session was present.',
  ip_consistent: 'Checks whether the source IP matches normal admin use.',
  source_ip_reputation: 'Checks source IP reputation, blocklist, and abuse-score signals when available.',
  keystroke_dynamics: 'Checks aggregate typing-pattern anomaly signals when available.',
  method_legitimate: 'Checks whether the change came through an approved admin workflow.',
  business_hours: 'Raises risk for changes outside normal working hours.',
  file_type_risk: 'Adds risk for web/code files that can affect the deployed system.',
  suspicious_pattern_score: 'Detects defacement, injection, and tampering patterns.',
  vpn_activity: 'Raises risk for VPN use without automatically marking it malicious.',
  unauthorized_admin_path: 'Raises risk for admin, auth, MFA, backup, recovery, or security-dashboard changes outside approved workflows.',
  sensitive_config_change: 'Raises risk for environment, Wazuh, dependency, and database configuration changes.',
  external_resource_injection: 'Raises risk for newly added remote script, link, form, or network-fetch references.',
};

const badgeClass = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (['critical', 'failed', 'compromised', 'missing', 'malicious', 'quarantined'].includes(normalized)) return 'bg-red-100 text-red-700 border-red-200';
  if (['high', 'modified', 'at risk', 'automatic'].includes(normalized)) return 'bg-orange-100 text-orange-700 border-orange-200';
  if (['medium', 'suspicious', 'reverted', 'false_positive', 'false positive', 'manual_backup', 'manual backup'].includes(normalized)) return 'bg-amber-100 text-amber-700 border-amber-200';
  if (['success', 'clean', 'protected', 'resolved', 'normal', 'recovered', 'legitimate', 'low'].includes(normalized)) return 'bg-green-100 text-green-700 border-green-200';
  if (['manual', 'manual_full', 'manual full', 'info'].includes(normalized)) return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
};

const humanize = (value) => String(value || 'n/a').replaceAll('_', ' ');
const titleize = (value) => humanize(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
const badgeText = (value) => String(value || '').toLowerCase() === 'false_positive' ? 'False' : titleize(value);
const detectionClassification = (item) => {
  if (item?.is_legitimate) return 'legitimate';
  return String(item?.ai_prediction || '').toLowerCase() === 'malicious' ? 'malicious' : 'suspicious';
};

const Badge = ({ children }) => (
  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(children)}`}>
    {badgeText(children)}
  </span>
);

const parseUtc = (value) => {
  if (!value) return null;
  const text = String(value);
  return new Date(text.endsWith('Z') || text.includes('+') ? text : `${text}Z`);
};

const formatDateTime = (value) => {
  const date = parseUtc(value);
  if (!date || Number.isNaN(date.getTime())) return 'Not scheduled';
  return date.toLocaleString('en-PH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  });
};

const formatLocalDateTime = (value) => {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not scheduled';
  return date.toLocaleString('en-PH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const toDateInputMin = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

const Section = ({ title, children, actions, className = '' }) => (
  <section className={`rounded-xl border border-slate-200 bg-white p-6 shadow-lg md:p-8 ${className}`.trim()}>
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
    {children}
  </section>
);

const MiniChart = ({ data, empty = 'No data yet.' }) => {
  const entries = Object.entries(data || {}).filter(([, value]) => Number(value) > 0);
  const max = Math.max(1, ...entries.map(([, value]) => Number(value)));
  if (!entries.length) return <p className="text-sm text-slate-500">{empty}</p>;

  return (
    <div className="space-y-3">
      {entries.map(([label, value], index) => (
        <div key={label} className="grid grid-cols-[5rem_1fr_2rem] items-center gap-3 text-sm sm:grid-cols-[8rem_1fr_2rem]">
          <span className="truncate font-semibold capitalize text-slate-700">{label.replaceAll('_', ' ')}</span>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className={['h-full rounded-full bg-green-500', 'h-full rounded-full bg-blue-500', 'h-full rounded-full bg-amber-500', 'h-full rounded-full bg-red-500', 'h-full rounded-full bg-purple-500'][index % 5]} style={{ width: `${(Number(value) / max) * 100}%` }} />
          </div>
          <span className="text-right font-bold text-slate-700">{value}</span>
        </div>
      ))}
    </div>
  );
};

const Filters = ({ filters, setFilters, showType, showStatus, showClassification = false }) => {
  const todayStr = new Date().toISOString().split('T')[0];
  return (
    <div className="grid w-full gap-3 md:ml-auto md:w-[min(100%,64rem)] md:grid-cols-6">
      <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Search keyword" value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} />
      <CustomDatePicker name="date_from" max={todayStr} value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
      <CustomDatePicker name="date_to" max={todayStr} value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
    {showType ? (
      <CustomSelect value={filters.type} onChange={(value) => setFilters({ ...filters, type: value })} options={[{ value: '', label: 'All types' }, ...showType.map((item) => ({ value: item, label: titleize(item) }))]} placeholder="All types" />
    ) : showClassification ? (
      <CustomSelect value={filters.classification} onChange={(value) => setFilters({ ...filters, classification: value })} options={[{ value: '', label: 'All classifications' }, { value: 'malicious', label: 'Malicious' }, { value: 'suspicious', label: 'Suspicious' }, { value: 'legitimate', label: 'Legitimate' }]} placeholder="All classifications" />
    ) : (
      <div />
    )}
    {showStatus ? (
      <CustomSelect value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} options={[{ value: '', label: 'All statuses' }, ...showStatus.map((item) => ({ value: item, label: titleize(item) }))]} placeholder="All statuses" />
    ) : (
      <CustomSelect value={filters.severity} onChange={(value) => setFilters({ ...filters, severity: value })} options={[{ value: '', label: 'All severities' }, ...severities.map((item) => ({ value: item, label: titleize(item) }))]} placeholder="All severities" />
    )}
    <CustomSelect value={filters.sort || 'newest'} onChange={(value) => setFilters({ ...filters, sort: value })} options={sortOptions} placeholder="Sort" />
  </div>
  );
};

const PaginationFooter = ({ state, onPage }) => {
  const [jumpPage, setJumpPage] = useState('');
  const totalPages = Math.max(1, Number(state.total_pages || 1));
  const currentPage = Math.min(Math.max(1, Number(state.page || 1)), totalPages);
  const goToPage = (page) => onPage(Math.min(Math.max(1, Number(page || 1)), totalPages));
  const submitJump = (event) => {
    event.preventDefault();
    goToPage(jumpPage || currentPage);
    setJumpPage('');
  };
  return (
  <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 lg:flex-row lg:items-center lg:justify-between">
    <p className="text-sm text-slate-500">
      Showing page {currentPage} of {totalPages} ({state.total} logs)
    </p>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <form onSubmit={submitJump} className="flex items-center gap-2">
        <label className="text-sm font-semibold text-slate-600">Jump to</label>
        <input
          type="number"
          min="1"
          max={totalPages}
          value={jumpPage}
          onChange={(event) => setJumpPage(event.target.value)}
          className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder={String(currentPage)}
        />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700">Go</button>
      </form>
      <button
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage <= 1}
        className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Previous
      </button>
      <button
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
      >
        Next
      </button>
    </div>
  </div>
  );
};

const SortHeader = ({ label, column, sort, setSort }) => {
  const active = sort.column === column;
  const direction = active ? sort.direction : 'asc';
  const arrow = direction === 'asc' ? '↑' : '↓';
  return (
    <button
      className="inline-flex items-center gap-1 font-bold uppercase tracking-[0.16em] text-slate-500 hover:text-primary"
      onClick={() => setSort({ column, direction: active && direction === 'asc' ? 'desc' : 'asc' })}
      aria-label={`Sort ${label} ${direction === 'asc' ? 'ascending' : 'descending'}`}
    >
      <span>{label}</span>
      <span className="text-sm leading-none" aria-hidden="true">{arrow}</span>
    </button>
  );
};

const ConfirmModal = ({ confirm, onCancel, onConfirm, busy }) => {
  if (!confirm) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-600">Please confirm</p>
        <h3 className="mt-2 text-xl font-bold text-slate-900">{confirm.title}</h3>
        <p className="mt-3 text-sm leading-6 text-slate-600">{confirm.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200" onClick={onCancel}>Cancel</button>
          <button className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60" onClick={onConfirm} disabled={busy}>{busy ? 'Working...' : confirm.confirmText || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
};

const FolderPicker = ({ picker, onClose, onSelect, onOpen }) => {
  if (!picker.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Folder picker</p>
              <h3 className="mt-2 text-xl font-bold text-slate-900">{picker.title}</h3>
              <p className="mt-1 break-all text-sm text-slate-600">{picker.current || 'Loading folders...'}</p>
            </div>
            <button className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 overflow-hidden p-5 md:grid-cols-[12rem_1fr]">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Quick roots</p>
            {[...(picker.quickRoots || []), ...(picker.drives || [])].map((item) => (
              <button key={item.path} className="w-full rounded-xl bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-blue-50 hover:text-primary" onClick={() => onOpen(item.path)}>
                {item.name}
              </button>
            ))}
          </div>

          <div className="min-h-0">
            <div className="mb-3 flex flex-wrap gap-2">
              {picker.parent && (
                <button className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700" onClick={() => onOpen(picker.parent)}>
                  Go up one folder
                </button>
              )}
              <button className="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white" onClick={() => onSelect(picker.current)}>
                Select this folder
              </button>
            </div>
            <div className="max-h-[46vh] overflow-auto rounded-xl border border-slate-200">
              {(picker.directories || []).map((item) => (
                <button key={item.path} className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => onOpen(item.path)}>
                  <span className="truncate">{item.name}</span>
                  <span className="text-xs text-slate-400">Open</span>
                </button>
              ))}
              {!picker.directories?.length && <p className="p-4 text-sm text-slate-500">No subfolders found here.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const BackupInventoryModal = ({ open, inventory, onClose }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="flex max-h-[82vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Backup inventory</p>
              <h3 className="mt-2 text-xl font-bold text-slate-900">Saved backups</h3>
              <p className="mt-1 text-sm text-slate-600">{(inventory?.items || []).length} backup(s) found.</p>
            </div>
            <button className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="min-h-0 overflow-auto p-5">
          {(inventory?.timeout) && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
              {inventory.warning || 'Backup inventory query timed out. Try again shortly.'}
            </div>
          )}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Filename</th>
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Timestamp</th>
                  <th className="px-3 py-2">Latest for</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(inventory?.items || []).length === 0 && (
                  <tr><td className="px-3 py-4 text-slate-500" colSpan={4}>No backups found.</td></tr>
                )}
                {(inventory?.items || []).map((item, index) => (
                  <tr key={`${item.path || item.filename}-${index}`} className="align-top">
                    <td className="max-w-[16rem] break-all px-3 py-2 font-semibold text-slate-800">{item.filename || 'Unknown'}</td>
                    <td className="px-3 py-2 text-slate-600">{item.label || item.backup_type || 'unknown'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{item.timestamp ? formatDateTime(item.timestamp) : 'Unknown'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {(item.latest_domains || []).length === 0 && <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">Older</span>}
                        {(item.latest_domains || []).map((domain) => (
                          <span key={domain} className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-700">
                            {recoveryDomainLabels[domain] || domain}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const BackupRecovery = () => {
  const todayStr = new Date().toISOString().split('T')[0];
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [files, setFiles] = useState([]);
  const [detections, setDetections] = useState([]);
  const [recoveries, setRecoveries] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [backups, setBackups] = useState([]);
  const [backupInventory, setBackupInventory] = useState(null);
  const [showBackupInventory, setShowBackupInventory] = useState(false);
  const [historyPages, setHistoryPages] = useState({
    backups: { page: 1, page_size: 10, total: 0, total_pages: 1 },
    detections: { page: 1, page_size: 10, total: 0, total_pages: 1 },
    recoveries: { page: 1, page_size: 10, total: 0, total_pages: 1 },
    incidents: { page: 1, page_size: 10, total: 0, total_pages: 1 },
  });
  const historyPagesRef = useRef(historyPages);
  const scanIntervalSavedAtRef = useRef(0);
  const [openRows, setOpenRows] = useState({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [weeklyAiData, setWeeklyAiData] = useState(null);
  const [securityUnreadCounts, setSecurityUnreadCounts] = useState({ detections: 0, recoveries: 0, backups: 0, incidents: 0 });
  const [detectionFilters, setDetectionFilters] = useState({ keyword: '', date_from: '', date_to: '', classification: '', severity: '', sort: 'newest' });
  const [recoveryFilters, setRecoveryFilters] = useState({ keyword: '', date_from: '', date_to: '', type: '', status: '', sort: 'newest' });
  const [incidentFilters, setIncidentFilters] = useState({ keyword: '', status: '', severity: '', date_from: '', date_to: '', sort: 'newest' });
  const [backupFilters, setBackupFilters] = useState({ keyword: '', date_from: '', date_to: '', type: '', status: '', sort: 'newest' });
  const [fileKeyword, setFileKeyword] = useState('');
  const [fileSort, setFileSort] = useState({ column: 'folder', direction: 'asc' });
  const [filePage, setFilePage] = useState(1);
  const [aiRules, setAiRules] = useState({});
  const [aiRuleTemplates, setAiRuleTemplates] = useState([]);
  const [showAiRules, setShowAiRules] = useState(false);
  const [showBackupPath, setShowBackupPath] = useState(false);
  const [folderPicker, setFolderPicker] = useState({
    open: false,
    mode: '',
    title: '',
    current: '',
    parent: null,
    directories: [],
    quickRoots: [],
    drives: [],
  });
  const [controls, setControls] = useState({
    backupPath: '',
    deletePrevious: false,
    backupDate: '',
    monitoredFolder: '',
    vm1MonitoredFolder: '',
    aiDay: 'Sunday',
    aiTime: '23:00',
    scanInterval: '30',
    scanIntervalDirty: false,
    monitoringEnabled: true,
    aiRuleTemplate: '',
    aiSensitivity: 'medium',
  });
  const [blockedIps, setBlockedIps] = useState([]);
  const [userRestrictions, setUserRestrictions] = useState([]);
  const [restrictionInput, setRestrictionInput] = useState({ account_id: '', account_type: 'citizen', scope: 'manual', duration: 900, reason: 'Manual temporary user restriction' });
  const [permanentBlocks, setPermanentBlocks] = useState([]);
  const [permanentBlockInput, setPermanentBlockInput] = useState('');
  const [permanentBlockReason, setPermanentBlockReason] = useState('');
  const [showPermanentBlocks, setShowPermanentBlocks] = useState(false);
  const navigate = useNavigate();

  const adminUser = useMemo(() => JSON.parse(localStorage.getItem('adminUser') || '{}'), []);
  const isSuperadmin = adminUser?.internal_role === 'superadmin';
  const adminLabel = isSuperadmin ? 'Superadmin' : 'Main Admin';

  const refreshDashboard = async () => {
    const response = await api.get('/security/dashboard');
    setDashboard(response.data);
    setControls((current) => ({
      ...current,
      backupPath: response.data?.health?.backup_location || current.backupPath,
      scanInterval: current.scanIntervalDirty ? current.scanInterval : String(response.data?.health?.scan_interval_seconds || current.scanInterval || 30),
      monitoringEnabled: String(response.data?.health?.monitoring_enabled || 'false').toLowerCase() === 'true',
    }));
  };

  const refreshAiSensitivity = async () => {
    const response = await api.get('/security/ai/sensitivity');
    setControls((current) => ({ ...current, aiSensitivity: response.data?.sensitivity || 'medium' }));
  };

  const refreshFiles = async () => setFiles((await api.get('/security/files')).data || []);

  useEffect(() => {
    historyPagesRef.current = historyPages;
  }, [historyPages]);

  const refreshUnreadCounts = async () => {
    const response = await api.get('/security/unread-counts');
    const nextCounts = response.data || { detections: 0, recoveries: 0, backups: 0, incidents: 0 };
    setSecurityUnreadCounts(nextCounts);
    window.dispatchEvent(new CustomEvent('security-notifications-updated', { detail: nextCounts }));
  };

  const updateHistoryPage = (key, data) => {
    setHistoryPages((current) => ({
      ...current,
      [key]: {
        page: data.page || current[key].page,
        page_size: data.page_size || 10,
        total: data.total || 0,
        total_pages: data.total_pages || 1,
      },
    }));
  };

  const refreshBackups = async (page = historyPagesRef.current.backups.page) => {
    const safePage = Math.max(1, Number(page || 1));
    const params = {
      keyword: backupFilters.keyword || undefined,
      date_from: backupFilters.date_from || undefined,
      date_to: backupFilters.date_to || undefined,
      recovery_type: backupFilters.type || undefined,
      status: backupFilters.status || undefined,
      sort: backupFilters.sort || 'newest',
      page: safePage,
      page_size: 10,
    };
    const response = await api.get('/security/backups', { params });
    setBackups(response.data?.items || []);
    updateHistoryPage('backups', response.data || {});
  };

  const refreshBackupInventory = async () => {
    const response = await api.get('/security/backups/inventory');
    setBackupInventory(response.data || { items: [] });
    return response;
  };

  const refreshDetections = async (page = historyPagesRef.current.detections.page) => {
    const safePage = Math.max(1, Number(page || 1));
    const params = {
      keyword: detectionFilters.keyword || undefined,
      date_from: detectionFilters.date_from || undefined,
      date_to: detectionFilters.date_to || undefined,
      classification: detectionFilters.classification || undefined,
      severity: detectionFilters.severity || undefined,
      sort: detectionFilters.sort || 'newest',
      page: safePage,
      page_size: 10,
    };
    const response = await api.get('/security/detections', { params });
    setDetections(response.data?.items || []);
    updateHistoryPage('detections', response.data || {});
  };

  const refreshRecoveries = async (page = historyPagesRef.current.recoveries.page) => {
    const safePage = Math.max(1, Number(page || 1));
    const params = {
      keyword: recoveryFilters.keyword || undefined,
      date_from: recoveryFilters.date_from || undefined,
      date_to: recoveryFilters.date_to || undefined,
      recovery_type: recoveryFilters.type || undefined,
      status: recoveryFilters.status || undefined,
      sort: recoveryFilters.sort || 'newest',
      page: safePage,
      page_size: 10,
    };
    const response = await api.get('/security/recoveries', { params });
    setRecoveries(response.data?.items || []);
    updateHistoryPage('recoveries', response.data || {});
  };

  const refreshIncidents = async (page = historyPagesRef.current.incidents.page) => {
    const safePage = Math.max(1, Number(page || 1));
    const params = {
      keyword: incidentFilters.keyword || undefined,
      status: incidentFilters.status || undefined,
      severity: incidentFilters.severity || undefined,
      date_from: incidentFilters.date_from || undefined,
      date_to: incidentFilters.date_to || undefined,
      sort: incidentFilters.sort || 'newest',
      page: safePage,
      page_size: 10,
    };
    const response = await api.get('/security/incidents', { params });
    setIncidents(response.data?.items || []);
    updateHistoryPage('incidents', response.data || {});
  };

  const refreshAiRules = async () => {
    const [response, templatesResponse] = await Promise.all([
      api.get('/security/ai/rules'),
      api.get('/security/ai/rule-templates'),
    ]);
    const rules = {};
    Object.entries(response.data || {}).forEach(([key, value]) => {
      rules[key] = {
        ...value,
        description: value.description || ruleHelp[key] || 'Behavioral anomaly rule.',
        configText: JSON.stringify(value.config || {}, null, 2),
      };
    });
    setAiRules(rules);
    setAiRuleTemplates(templatesResponse.data || []);
  };

  const refreshBlockedIps = async () => {
    const response = await api.get('/security/blocked-ips');
    setBlockedIps(response.data?.blocked_ips || []);
  };

  const unblockIp = async (ip) => {
    try {
      await api.delete(`/security/blocked-ips/${ip}`);
      setNotice(`IP ${ip} unblocked.`);
      await refreshBlockedIps();
    } catch (error) {
      setNotice(error.response?.data?.detail || 'Failed to unblock IP.');
    }
  };

  const refreshPermanentBlocks = async () => {
    try {
      const response = await api.get('/security/permanent-blocks');
      setPermanentBlocks(response.data?.permanent_blocks || []);
    } catch (error) {
      setNotice(error.response?.data?.detail || 'Failed to load permanent blocks.');
    }
  };

  const refreshUserRestrictions = async () => {
    const response = await api.get('/security/user-restrictions');
    setUserRestrictions(response.data?.user_restrictions || []);
  };

  const restrictUser = async () => {
    if (!restrictionInput.account_id.trim()) {
      setNotice('Please enter an account ID.');
      return;
    }
    try {
      await api.post('/security/user-restrictions', { ...restrictionInput, account_id: restrictionInput.account_id.trim(), duration: Number(restrictionInput.duration || 900) });
      setNotice(`Temporary restriction applied to ${restrictionInput.account_type}:${restrictionInput.account_id.trim()}.`);
      setRestrictionInput((current) => ({ ...current, account_id: '' }));
      await refreshUserRestrictions();
    } catch (error) {
      setNotice(error.response?.data?.detail || 'Failed to apply temporary restriction.');
    }
  };

  const addPermanentBlock = async () => {
    if (!permanentBlockInput.trim()) {
      setNotice('Please enter an IP address.');
      return;
    }
    if (!permanentBlockReason.trim()) {
      setNotice('Please provide a reason for the permanent block.');
      return;
    }
    try {
      const response = await api.post('/security/permanent-blocks', { ip: permanentBlockInput.trim(), reason: permanentBlockReason.trim() });
      setNotice(`IP ${permanentBlockInput.trim()} permanently blocked.`);
      setPermanentBlockInput('');
      setPermanentBlockReason('');
      const newBlock = response.data?.permanent_block;
      if (newBlock) {
        setPermanentBlocks((current) => [newBlock, ...current]);
      }
      await refreshPermanentBlocks();
      await refreshBlockedIps();
    } catch (error) {
      setNotice(error.response?.data?.detail || 'Failed to permanently block IP.');
    }
  };

  const removePermanentBlock = async (ip) => {
    try {
      await api.delete(`/security/permanent-blocks/${ip}`);
      setNotice(`IP ${ip} removed from permanent blocklist.`);
      await refreshPermanentBlocks();
      await refreshBlockedIps();
    } catch (error) {
      setNotice(error.response?.data?.detail || 'Failed to remove permanent block.');
    }
  };

  const refreshActiveTab = async (tab = activeTab, page) => {
    if (tab === 'File Status') {
      await refreshFiles();
      return;
    }
    if (tab === 'Detection History') {
      await refreshDetections(page);
      return;
    }
    if (tab === 'Recovery History') {
      await refreshRecoveries(page);
      return;
    }
    if (tab === 'Security Incidents') {
      await refreshIncidents(page);
      return;
    }
    if (tab === 'Backup History') {
      await refreshBackups(page);
      return;
    }
    if (tab === 'Manual Controls') {
      await Promise.all([
        refreshAiRules(),
        refreshAiSensitivity(),
        refreshBlockedIps(),
        refreshPermanentBlocks(),
        refreshUserRestrictions(),
      ]);
    }
  };

  const refreshAll = async () => {
    try {
      await Promise.all([refreshDashboard(), refreshUnreadCounts()]);
      await refreshActiveTab();
    } catch (error) {
      setNotice(error.response?.data?.detail || 'Unable to load the Security Dashboard.');
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshDashboard();
      refreshUnreadCounts();
    }, 10000);
    return () => clearInterval(timer);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'Backup History') {
      refreshBackups(1);
    }
  }, [backupFilters]);

  useEffect(() => {
    if (activeTab === 'Detection History') {
      refreshDetections(1);
    }
  }, [detectionFilters]);

  useEffect(() => {
    if (activeTab === 'Recovery History') {
      refreshRecoveries(1);
    }
  }, [recoveryFilters]);

  useEffect(() => {
    if (activeTab === 'Security Incidents') {
      refreshIncidents(1);
    }
  }, [incidentFilters]);

  useEffect(() => {
    setFilePage(1);
  }, [fileKeyword, fileSort]);

  const markSeen = (type, ids) => {
    const uniqueIds = Array.from(new Set((ids || []).filter((id) => id !== undefined && id !== null).map(Number)));
    if (!uniqueIds.length) return;
    api.post(`/security/${type}/mark-viewed`, uniqueIds)
      .then((response) => {
        if (response.data?.unread_counts) {
          setSecurityUnreadCounts(response.data.unread_counts);
          window.dispatchEvent(new CustomEvent('security-notifications-updated', { detail: response.data.unread_counts }));
        } else {
          refreshUnreadCounts();
        }
      })
      .catch(() => {});
    if (type === 'detections') {
      setDetections((current) => current.map((item) => uniqueIds.includes(Number(item.id)) ? { ...item, is_viewed: true } : item));
    }
    if (type === 'recoveries') {
      setRecoveries((current) => current.map((item) => uniqueIds.includes(Number(item.id)) ? { ...item, is_viewed: true } : item));
    }
    if (type === 'backups') {
      setBackups((current) => current.map((item) => uniqueIds.includes(Number(item.id)) ? { ...item, is_viewed: true } : item));
    }
  };

  const markAllSeen = (type) => {
    api.post(`/security/${type}/mark-viewed`)
      .then((response) => {
        if (response.data?.unread_counts) {
          setSecurityUnreadCounts(response.data.unread_counts);
          window.dispatchEvent(new CustomEvent('security-notifications-updated', { detail: response.data.unread_counts }));
        } else {
          refreshUnreadCounts();
        }
      })
      .catch(() => {});
    if (type === 'detections') {
      setDetections((current) => current.map((item) => ({ ...item, is_viewed: true })));
    }
    if (type === 'recoveries') {
      setRecoveries((current) => current.map((item) => ({ ...item, is_viewed: true })));
    }
    if (type === 'backups') {
      setBackups((current) => current.map((item) => ({ ...item, is_viewed: true })));
    }
  };

  const changeTab = (tab) => {
    if (activeTab === 'Detection History' && tab !== 'Detection History') {
      markAllSeen('detections');
    }
    if (activeTab === 'Recovery History' && tab !== 'Recovery History') {
      markAllSeen('recoveries');
    }
    if (activeTab === 'Backup History' && tab !== 'Backup History') {
      markAllSeen('backups');
    }
    setActiveTab(tab);
    refreshActiveTab(tab, 1).catch((error) => {
      setNotice(error.response?.data?.detail || `Unable to load ${tab}.`);
    });
  };

  const visibleDetectionKey = detections.map((item) => item.id).join(',');
  const visibleRecoveryKey = recoveries.map((item) => item.id).join(',');
  const visibleBackupKey = backups.map((item) => item.id).join(',');

  useEffect(() => {
    if (activeTab === 'Detection History') {
      markAllSeen('detections');
    }
  }, [activeTab, visibleDetectionKey]);

  useEffect(() => {
    if (activeTab === 'Recovery History') {
      markAllSeen('recoveries');
    }
  }, [activeTab, visibleRecoveryKey]);

  useEffect(() => {
    if (activeTab === 'Backup History') {
      markAllSeen('backups');
    }
  }, [activeTab, visibleBackupKey]);

  const formatMissingFileConfirmation = (detail) => {
    if (detail?.suppress_file_list) {
      return detail?.message || 'Some incident files need confirmation before this action can continue.';
    }
    const incidentsList = (detail?.incidents || []).map((item) => {
      const missingFiles = (item.missing_files || []).join(', ');
      const missingQuarantine = (item.missing_quarantine_paths || []).join(', ');
      return `Incident #${item.incident_id}: ${[missingFiles && `deleted file: ${missingFiles}`, missingQuarantine && `missing quarantine: ${missingQuarantine}`].filter(Boolean).join('; ')}`;
    });
    return [detail?.message, ...incidentsList].filter(Boolean).join(' ');
  };

  const runAction = async (action, success, label = 'Working on the requested security operation...') => {
    setBusy(true);
    setBusyLabel(label);
    setNotice('');
    try {
      const result = await action();
      setNotice(typeof success === 'function' ? success(result) : success);
      if (!result?.skipRefresh) {
        await refreshDashboard();
        await refreshActiveTab();
        await refreshUnreadCounts();
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      if (error.response?.status === 409 && detail?.requires_confirmation) {
        setConfirm({
          title: 'Deleted file confirmation required',
          message: formatMissingFileConfirmation(detail),
          action: () => action({ confirmMissingFiles: true }),
          success,
          confirmText: 'Continue anyway',
        });
      } else {
        setNotice(typeof detail === 'string' ? detail : detail?.message || error.message || 'Action failed.');
      }
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  };

  const bulkIncidentAction = (action) => () => api.patch('/security/incidents/bulk-action', { action, confirm_missing_files: true });

  const incidentStatusAction = (incidentId, actionPath) => () => api.patch(`/security/incidents/${incidentId}/${actionPath}`, null, { params: { confirm_missing_files: true } });

  const askConfirm = (title, message, action, success, confirmText = 'Confirm') => {
    setConfirm({ title, message, action, success, confirmText });
  };

  const handleConfirm = async () => {
    const current = confirm;
    setConfirm(null);
    if (current) {
      await runAction(current.action, current.success, current.title);
    }
  };

  const disabledButtonClass = busy ? ' opacity-60 cursor-not-allowed' : '';

  const toggleRow = (key) => setOpenRows((current) => ({ ...current, [key]: !current[key] }));

  const toggleBackupRow = (key, id) => {
    markSeen('backups', [id]);
    toggleRow(key);
  };

  const toggleDetectionRow = (key, id) => {
    markSeen('detections', [id]);
    toggleRow(key);
  };

  const toggleRecoveryRow = (key, id) => {
    markSeen('recoveries', [id]);
    toggleRow(key);
  };

  const confirmReturnToAdmin = async () => {
    localStorage.removeItem('securityAuthenticated');
    localStorage.removeItem('securityAuthenticatedAt');
    sessionStorage.removeItem('securityAuthenticated');
    sessionStorage.removeItem('securityAuthenticatedAt');
    navigate('/admin');
    return { skipRefresh: true };
  };

  const returnToAdmin = () => {
    askConfirm(
      `Return to ${isSuperadmin ? 'superadmin' : 'admin'} dashboard?`,
      'This will close your Security Dashboard session and return you to the admin dashboard.',
      confirmReturnToAdmin,
      'Returning to dashboard...',
      'Return'
    );
  };

  const updateRule = (ruleKey, patch) => {
    setAiRules((current) => ({
      ...current,
      [ruleKey]: {
        ...current[ruleKey],
        ...patch,
      },
    }));
  };

  const saveAiRules = async () => {
    const rules = {};
    Object.entries(aiRules).forEach(([key, value]) => {
      let parsedConfig = {};
      try {
        parsedConfig = value.configText?.trim() ? JSON.parse(value.configText) : {};
      } catch (error) {
        throw new Error(`${key} has invalid JSON configuration.`);
      }
      rules[key] = {
        enabled: Boolean(value.enabled),
        weight: Number(value.weight || 0),
        description: value.description || ruleHelp[key] || '',
        config: parsedConfig,
      };
    });
    await api.put('/security/ai/rules', { rules });
  };

  const addSelectedAiRule = async () => {
    if (!controls.aiRuleTemplate) {
      throw new Error('Choose an approved rule from the list first.');
    }
    await api.post('/security/ai/rules/add', { rule_key: controls.aiRuleTemplate });
    setControls((current) => ({ ...current, aiRuleTemplate: '' }));
    await refreshAiRules();
  };

  const saveScanInterval = () => {
    const seconds = Number(controls.scanInterval);
    if (!Number.isFinite(seconds) || seconds < 5) {
      throw new Error('Scan interval must be at least 5 seconds.');
    }
    return api.put('/security/scan-interval', { seconds }).then((response) => {
      setControls((current) => ({ ...current, scanInterval: String(seconds), scanIntervalDirty: true }));
      scanIntervalSavedAtRef.current = Date.now();
      setTimeout(() => {
        setControls((current) => ({ ...current, scanIntervalDirty: false }));
      }, 5000);
      return { ...response, skipRefresh: true };
    });
  };

  const toggleMonitoring = async () => {
    const nextEnabled = !controls.monitoringEnabled;
    const response = await api.put('/security/monitoring', { enabled: nextEnabled });
    setControls((current) => ({ ...current, monitoringEnabled: nextEnabled }));
    return response;
  };

  const saveAiSensitivity = () => {
    return api.put('/security/ai/sensitivity', { sensitivity: controls.aiSensitivity }).then((response) => { setControls((current) => ({ ...current, aiSensitivity: response.data?.sensitivity || 'medium' })); return response; });
  };

  const openFolderPicker = async (mode, title, path) => {
    const response = await api.get('/security/folder-browser', { params: { path: path || undefined } });
    setFolderPicker({
      open: true,
      mode,
      title,
      current: response.data.current,
      parent: response.data.parent,
      directories: response.data.directories || [],
      quickRoots: response.data.quick_roots || [],
      drives: response.data.drives || [],
    });
  };

  const closeFolderPicker = () => setFolderPicker((current) => ({ ...current, open: false }));

  const selectFolder = async (path) => {
    closeFolderPicker();
    if (folderPicker.mode === 'backup') {
      setControls((current) => ({ ...current, backupPath: path }));
      askConfirm(
        'Change backup location?',
        `WARDS will use ${path} for new trusted backups. The selected folder must be an absolute, writable directory on the security server.`,
        async () => {
          const response = await api.post('/security/backup/location', { path, delete_previous: controls.deletePrevious });
          await refreshBackupInventory();
          return response;
        },
        'Backup location updated.',
        'Save location',
      );
      return;
    }
    // add-monitor and remove-monitor modes deprecated; use automatic deployment scans instead
    // (kept backup mode for backup location selection)
  };

  const loadWeeklyAiData = () => runAction(async () => {
    const response = await api.get('/security/ai/weekly-data');
    setWeeklyAiData(response.data);
    return response;
  }, 'This week\'s AI behavior data loaded.', 'Loading this week\'s AI behavior data...');

  const cards = dashboard ? [
    ['System Status', dashboard.system_status],
    ['Monitored Files', dashboard.monitored_files],
    ['Active Incidents', dashboard.active_incidents],
    ['Last Scan', dashboard.last_scan ? formatDateTime(dashboard.last_scan) : 'No scans yet'],
  ] : [];

  const dashboardNotifications = dashboard?.notification_counts || {};
  const activeIncidentCount = Number(dashboard?.active_incidents || 0);
  const notificationCounts = {
    Dashboard: activeIncidentCount,
    'File Status': files.length
      ? files.filter((file) => ['modified', 'missing', 'compromised'].includes(String(file.status).toLowerCase())).length
      : Number(dashboardNotifications.files || 0),
    'Detection History': Number(securityUnreadCounts.detections || 0),
    'Recovery History': Number(securityUnreadCounts.recoveries || 0),
    'Security Incidents': activeIncidentCount,
    'Backup History': Number(securityUnreadCounts.backups || 0),
    'Manual Controls': 0,
  };

  const visibleFiles = useMemo(() => {
    const keyword = fileKeyword.trim().toLowerCase();
    const valueFor = (file) => {
      if (fileSort.column === 'folder') return String(file.folder_root || '').toLowerCase();
      if (fileSort.column === 'status') return String(file.status || '').toLowerCase();
      if (fileSort.column === 'type') return String(file.file_type || '').toLowerCase();
      if (fileSort.column === 'size') return Number(file.size_bytes || 0);
      if (fileSort.column === 'last_checked') return file.last_checked ? new Date(file.last_checked).getTime() : 0;
      return String(file.relative_path || '').toLowerCase();
    };
    return files
      .filter((file) => {
        if (!keyword) return true;
        return [file.relative_path, file.folder_root, file.status, file.file_type]
          .some((value) => String(value || '').toLowerCase().includes(keyword));
      })
      .sort((left, right) => {
        const leftValue = valueFor(left);
        const rightValue = valueFor(right);
        let result = typeof leftValue === 'number'
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
        if (result === 0) {
          result = String(left.relative_path || '').localeCompare(String(right.relative_path || ''));
        }
        return fileSort.direction === 'asc' ? result : -result;
      });
  }, [files, fileKeyword, fileSort]);

  return (
    <div className="min-h-screen bg-lightbg">
      <ConfirmModal confirm={confirm} onCancel={() => setConfirm(null)} onConfirm={handleConfirm} busy={busy} />
      <FolderPicker
        picker={folderPicker}
        onClose={closeFolderPicker}
        onSelect={selectFolder}
        onOpen={(path) => openFolderPicker(folderPicker.mode, folderPicker.title, path)}
      />
      <BackupInventoryModal
        open={showBackupInventory}
        inventory={backupInventory}
        onClose={() => setShowBackupInventory(false)}
      />
      <header className="sticky top-0 z-40 bg-primary px-4 py-3 shadow-lg md:px-8">
        <div className="flex w-full items-center justify-between">
          <PublicBrandLogo
            clickable={false}
            compact
            title="Security Dashboard"
            subtitle="WARDS Threat Monitoring"
          />
          <button onClick={returnToAdmin} className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20">
            Return to {adminLabel} Dashboard
          </button>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-3.5rem)]">
        {/* Desktop sidebar tabs */}
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
          <div className="border-b border-slate-200 p-4">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold text-white ${isSuperadmin ? 'bg-fuchsia-600' : 'bg-purple-500'}`}>
              {adminLabel}
            </span>
          </div>
          <nav className="p-3">
            {tabs.map((tab) => {
              const tabIcons = {
                Dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
                'File Status': 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
                'Backup History': 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
                'Detection History': 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
                'Recovery History': 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
                'Security Incidents': 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
                'Manual Controls': 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
              };
              return (
                <button
                  key={tab}
                  onClick={() => changeTab(tab)}
                  className={`mb-1 flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-medium transition ${activeTab === tab ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  <span className="flex items-center gap-3">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={tabIcons[tab]} />
                    </svg>
                    {tab}
                  </span>
                  {notificationCounts[tab] > 0 && (
                    <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                      {notificationCounts[tab]}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1">
          {/* Mobile tabs */}
          <div className="border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
            <div className="flex gap-1 overflow-x-auto pb-1">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => changeTab(tab)}
                  className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition ${activeTab === tab ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {tab}
                  {notificationCounts[tab] > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {notificationCounts[tab]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <main className="space-y-6 p-4 md:p-8">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white px-6 py-6 text-slate-900 shadow-lg md:px-8 md:py-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Security Operations Center</p>
              <h1 className="mt-2 text-2xl font-bold md:text-3xl">Backup & Recovery</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">Local backup, Wazuh-fed monitoring, AI anomaly detection, quarantine, and recovery controls for the WARDS and OCR folders.</p>
            </div>
            <Badge>{dashboard?.system_status || 'Loading'}</Badge>
          </div>
        </section>

          {notice && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
              {notice}
            </div>
          )}

          {busy && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              {busyLabel || 'Working on the requested security operation...'}
            </div>
          )}

          {activeTab === 'Dashboard' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {cards.map(([label, value]) => {
                  let gradient = 'from-blue-500 to-blue-600';
                  let icon = (
                    <svg className="h-10 w-10 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  );
                  if (label === 'System Status') {
                    gradient = String(value).toLowerCase() === 'protected' ? 'from-green-500 to-green-600' : 'from-orange-500 to-orange-600';
                    icon = (
                      <svg className="h-10 w-10 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    );
                  } else if (label === 'Active Incidents') {
                    gradient = Number(value || 0) === 0 ? 'from-green-400 to-green-500' : 'from-orange-400 to-orange-500';
                    icon = (
                      <svg className="h-10 w-10 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    );
                  } else if (label === 'Monitored Files') {
                    gradient = 'from-yellow-400 to-yellow-500';
                    icon = (
                      <svg className="h-10 w-10 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    );
                  }
                  return (
                    <div key={label} className={`rounded-xl bg-gradient-to-br ${gradient} p-6 text-white shadow-lg`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="mb-1 text-sm text-white/80">{label}</p>
                          <p className="text-2xl font-bold">{value}</p>
                        </div>
                        {icon}
                      </div>
                    </div>
                  );
                })}
              </div>

              {dashboard?.today_summary && (
                <div className={`rounded-xl border p-5 ${dashboard.today_summary.high_severity > 0 ? 'border-red-200 bg-red-50 text-red-900' : dashboard.today_summary.incidents > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-green-200 bg-green-50 text-green-900'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{dashboard.today_summary.high_severity > 0 ? '⚠️' : dashboard.today_summary.incidents > 0 ? '📊' : '✅'}</span>
                    <div className="flex-1">
                      <p className="text-sm font-bold">
                        Today's Report — {dashboard.today_summary.incidents} incident(s), {dashboard.today_summary.detections} detection(s)
                      </p>
                      <p className="mt-1 text-sm leading-6">{dashboard.today_summary.recommendation}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
                <p className="text-sm font-bold">Scheduled backup reminder</p>
                <p className="mt-1 text-sm">
                  {dashboard?.next_scheduled_backup && dashboard.next_scheduled_backup !== 'Not scheduled'
                    ? `The next scheduled backup is on ${formatLocalDateTime(dashboard.next_scheduled_backup)}.`
                    : 'No automatic backup has been scheduled yet.'}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <Section title="Severity Score Distribution">
                  <MiniChart data={dashboard?.severity_distribution} />
                  <p className="mt-4 text-sm leading-6 text-slate-600">{dashboard?.traffic_summaries?.severity}</p>
                </Section>
                <Section title="Types of Attacks Detected">
                  <MiniChart data={dashboard?.attack_types} />
                  <p className="mt-4 text-sm leading-6 text-slate-600">{dashboard?.traffic_summaries?.attacks}</p>
                </Section>
                <Section title="Monitored Behaviors">
                  <MiniChart data={dashboard?.behaviors} />
                  <p className="mt-4 text-sm leading-6 text-slate-600">{dashboard?.traffic_summaries?.behaviors}</p>
                </Section>
              </div>

              <Section title="System Health">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
                  {Object.entries(dashboard?.health || {}).filter(([key]) => key !== 'backup_location').map(([key, value]) => (
                    <div key={key} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{key.replaceAll('_', ' ')}</p>
                      <p className="mt-2 overflow-hidden break-words text-sm font-bold text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}

          {activeTab === 'File Status' && (
            <Section
              title="Monitored Files"
              actions={(
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm md:w-80"
                  placeholder="Search files by keyword"
                  value={fileKeyword}
                  onChange={(e) => setFileKeyword(e.target.value)}
                />
              )}
            >
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm min-w-[56rem]">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="min-w-[240px] px-4 py-3">File</th>
                      <th className="min-w-[80px] px-4 py-3"><SortHeader label="Folder" column="folder" sort={fileSort} setSort={setFileSort} /></th>
                      <th className="min-w-[100px] px-4 py-3"><SortHeader label="Status" column="status" sort={fileSort} setSort={setFileSort} /></th>
                      <th className="min-w-[60px] px-4 py-3"><SortHeader label="Type" column="type" sort={fileSort} setSort={setFileSort} /></th>
                      <th className="min-w-[80px] px-4 py-3"><SortHeader label="Size" column="size" sort={fileSort} setSort={setFileSort} /></th>
                      <th className="min-w-[160px] px-4 py-3"><SortHeader label="Last Checked" column="last_checked" sort={fileSort} setSort={setFileSort} /></th>
                      <th className="min-w-[140px] px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleFiles.slice((filePage - 1) * FILE_PAGE_SIZE, filePage * FILE_PAGE_SIZE).map((file) => (
                      <tr key={file.id} className="hover:bg-slate-50/60 transition">
                        <td className="max-w-xs px-4 py-3 font-semibold text-slate-800">
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={file.relative_path}>{file.relative_path}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={file.folder_root}>{file.folder_root}</span>
                        </td>
                        <td className="px-4 py-3"><Badge>{file.status}</Badge></td>
                        <td className="px-4 py-3 text-slate-600">{file.file_type}</td>
                        <td className="px-4 py-3 text-slate-600">{Number(file.size_bytes || 0).toLocaleString()} B</td>
                        <td className="px-4 py-3 text-slate-600">{file.last_checked ? new Date(file.last_checked).toLocaleString() : 'n/a'}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button disabled={busy} className={`rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200${disabledButtonClass}`} onClick={() => runAction(() => api.post(`/security/files/${file.id}/scan`), (result) => result?.data?.detection ? `Changes found in ${file.relative_path}. Detection log created.` : `No changes found in ${file.relative_path}.`, `Scanning ${file.relative_path}...`)}>Scan</button>
                            <button disabled={busy} className={`rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-blue-900${disabledButtonClass}`} onClick={() => askConfirm('Recover this file from backup?', `This will restore ${file.relative_path} from the trusted local backup. There may be file or path mismatches if the file was moved, renamed, or backed up before recent structural changes. A full system backup is still recommended before relying on individual file recovery.`, () => api.post(`/security/files/${file.id}/recover`), 'File recovery complete.', 'Recover file')}>Recover</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!visibleFiles.length && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-sm font-semibold text-slate-500">No monitored files match your search.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <PaginationFooter
                state={{ page: filePage, total_pages: Math.max(1, Math.ceil(visibleFiles.length / FILE_PAGE_SIZE)), total: visibleFiles.length }}
                onPage={setFilePage}
              />
            </Section>
          )}

          {activeTab === 'Backup History' && (
            <Section title="Backup History" actions={<Filters filters={backupFilters} setFilters={setBackupFilters} showType={['manual_backup', 'automatic_backup']} showStatus={['success', 'failed', 'in_progress']} />}>
              <div className="space-y-3">
                {backups.map((item) => {
                  const key = `b-${item.id}`;
                  const unseen = !item.is_viewed;
                  return (
                    <div key={item.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
                      {unseen && <span className="absolute right-3 top-3 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">New</span>}
                      <button className="grid w-full gap-3 pr-12 text-left md:grid-cols-[minmax(0,1fr)_auto] md:items-center" onClick={() => toggleBackupRow(key, item.id)}>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">{item.summary || 'Backup completed'}</p>
                          <p className="text-sm text-slate-500">{formatDateTime(item.started_at)}</p>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end md:text-right">
                          <span className="max-w-xs truncate text-xs font-semibold text-slate-500">{item.backup_path || 'No path recorded'}</span>
                          <Badge>{item.recovery_type}</Badge>
                          <Badge>{item.status}</Badge>
                        </div>
                      </button>
                      {openRows[key] && (
                        <pre className="mt-4 max-h-64 overflow-auto rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(item, null, 2)}</pre>
                      )}
                    </div>
                  );
                })}
                {!backups.length && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No backup history matched the current filters.</p>}
              </div>
              <PaginationFooter state={historyPages.backups} onPage={refreshBackups} />
            </Section>
          )}

          {activeTab === 'Detection History' && (
            <Section title="Detection Logs" actions={<Filters filters={detectionFilters} setFilters={setDetectionFilters} showClassification />}>
              <div className="space-y-3">
                {detections.map((item) => {
                  const key = `d-${item.id}`;
                  const unseen = !item.is_legitimate && !item.is_viewed;
                  return (
                    <div key={item.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
                      {unseen && <span className="absolute right-3 top-3 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">New</span>}
                      <button className="grid w-full gap-3 pr-12 text-left md:grid-cols-[minmax(0,1fr)_auto] md:items-center" onClick={() => toggleDetectionRow(key, item.id)}>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">{item.target_name}</p>
                          <p className="text-sm text-slate-500">{item.trigger_summary}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{formatDateTime(item.detected_at)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end md:text-right">
                          <span className="text-xs font-semibold text-slate-500">{Math.round(Number(item.confidence || 0) * 100)}% confidence</span>
                          <Badge>{item.severity_level}</Badge>
                          <Badge>{detectionClassification(item)}</Badge>
                        </div>
                      </button>
                      {openRows[key] && (
                        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
                          <div>
                            <p className="text-sm font-bold text-slate-800">Accuracy basis</p>
                            <p className="mt-1 text-sm leading-6 text-slate-600">{item.accuracy_basis}</p>
                            <p className="mt-3 text-sm font-bold text-slate-800">Behaviors</p>
                            <p className="mt-1 text-sm text-slate-600">{(item.behaviors || []).map(humanize).join(', ') || 'No extra behavior flags'}</p>
                          </div>
                          <pre className="max-h-64 overflow-auto rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(item.changed_lines, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <PaginationFooter state={historyPages.detections} onPage={refreshDetections} />
            </Section>
          )}

          {activeTab === 'Recovery History' && (
            <Section title="Recovery Logs" actions={<Filters filters={recoveryFilters} setFilters={setRecoveryFilters} showType={['automatic', 'manual', 'manual_full']} showStatus={['success', 'failed', 'reverted', 'in_progress']} />}>
              <div className="space-y-3">
                {recoveries.map((item) => {
                  const key = `r-${item.id}`;
                  const unseen = !item.is_viewed;
                  return (
                    <div key={item.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
                      {unseen && <span className="absolute right-3 top-3 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">New</span>}
                      <button className="grid w-full gap-3 pr-12 text-left md:grid-cols-[minmax(0,1fr)_auto] md:items-center" onClick={() => toggleRecoveryRow(key, item.id)}>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">{item.summary || item.recovery_type}</p>
                          <p className="text-sm text-slate-500">{formatDateTime(item.started_at)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end md:text-right">
                          <span className="text-xs font-semibold text-slate-500">{item.recovery_duration_ms || 0} ms</span>
                          <Badge>{item.recovery_type}</Badge>
                          <Badge>{item.status}</Badge>
                        </div>
                      </button>
                      {openRows[key] && (
                        <pre className="mt-4 max-h-64 overflow-auto rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(item, null, 2)}</pre>
                      )}
                    </div>
                  );
                })}
              </div>
              <PaginationFooter state={historyPages.recoveries} onPage={refreshRecoveries} />
            </Section>
          )}

          {activeTab === 'Security Incidents' && (
            <Section
              title="Security Incidents"
              actions={
                <div className="grid w-full gap-3 md:ml-auto md:w-[min(100%,64rem)] md:grid-cols-6">
                  <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm" placeholder="Search incidents" value={incidentFilters.keyword} onChange={(e) => setIncidentFilters({ ...incidentFilters, keyword: e.target.value })} />
                  <CustomDatePicker name="date_from" max={todayStr} value={incidentFilters.date_from} onChange={(e) => setIncidentFilters({ ...incidentFilters, date_from: e.target.value })} />
                  <CustomDatePicker name="date_to" max={todayStr} value={incidentFilters.date_to} onChange={(e) => setIncidentFilters({ ...incidentFilters, date_to: e.target.value })} />
                  <CustomSelect value={incidentFilters.status} onChange={(value) => setIncidentFilters({ ...incidentFilters, status: value })} options={[{ value: '', label: 'All statuses' }, ...['open', 'investigating', 'resolved', 'false_positive'].map((item) => ({ value: item, label: badgeText(item) }))]} placeholder="All statuses" />
                  <CustomSelect value={incidentFilters.severity} onChange={(value) => setIncidentFilters({ ...incidentFilters, severity: value })} options={[{ value: '', label: 'All severities' }, ...severities.map((item) => ({ value: item, label: titleize(item) }))]} placeholder="All severities" />
                  <CustomSelect value={incidentFilters.sort} onChange={(value) => setIncidentFilters({ ...incidentFilters, sort: value })} options={sortOptions} placeholder="Sort" />
                </div>
              }
            >
              <div className="mb-4 flex flex-wrap gap-2">
                <button disabled={busy} className={`rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-green-700${disabledButtonClass}`} onClick={() => askConfirm('Mark all unresolved incidents as resolved?', 'This will close every open or investigating incident and delete their quarantine folders. Logs will remain. The backup will not be changed because resolved incidents keep the current clean files.', bulkIncidentAction('resolve'), 'All unresolved incidents marked as resolved.', 'Resolve all')}>Mark all as resolved</button>
                <button disabled={busy} className={`rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600${disabledButtonClass}`} onClick={() => askConfirm('Mark all unresolved incidents as false positives?', 'This will accept every open or investigating quarantined file as authorized, update the backup, and delete quarantine folders. Logs will remain.', bulkIncidentAction('false_positive'), 'All unresolved incidents marked as false positive.', 'Mark all False+')}>Mark all as False+</button>
                <button disabled={busy} className={`rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700${disabledButtonClass}`} onClick={() => askConfirm('Mark all open incidents as investigating?', 'This will move every open incident into investigating status so your team can review them. No files will be restored or deleted.', bulkIncidentAction('investigating'), 'All open incidents marked as investigating.', 'Mark investigating')}>Mark all as investigating</button>
              </div>
              <div className="space-y-3">
                {incidents.map((item) => {
                  const key = `i-${item.id}`;
                  const unresolved = ['open', 'investigating'].includes(String(item.status).toLowerCase());
                  return (
                    <div key={item.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
                      {unresolved && <span className="absolute right-3 top-3 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">Open</span>}
                      <button className="grid w-full gap-3 pr-12 text-left md:grid-cols-[minmax(0,1fr)_auto] md:items-center" onClick={() => toggleRow(key)}>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">{titleize(item.incident_type)}</p>
                          <p className="text-sm text-slate-500">{item.description}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{formatDateTime(item.created_at)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end md:text-right">
                          <span className="text-xs font-bold text-slate-700">CVSS {item.cvss_score}</span>
                          <Badge>{item.severity_level}</Badge>
                          <Badge>{item.status}</Badge>
                        </div>
                      </button>
                      {openRows[key] && (
                        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">NIST</p><p className="mt-1 text-sm font-semibold text-slate-900">{item.nist_category}</p></div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">ENISA</p><p className="mt-1 text-sm font-semibold text-slate-900">{item.enisa_threat_type}</p></div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Action</p><p className="mt-1 text-sm font-semibold text-slate-900">{item.response_action}</p></div>
                          </div>
                          <p className="text-sm text-slate-700"><strong>Behaviors:</strong> {(item.behaviors || []).map(humanize).join(', ') || 'None'}</p>
                          <p className="text-sm text-slate-700"><strong>Affected files:</strong> {(item.affected_files || []).join(', ') || 'None'}</p>
                          <pre className="max-h-64 overflow-auto rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(item.changed_lines, null, 2)}</pre>
                          {unresolved && (
                            <div className="flex flex-wrap gap-2">
                              <button disabled={busy} className={`rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-green-700${disabledButtonClass}`} onClick={(event) => { event.stopPropagation(); askConfirm('Resolve this incident?', 'WARDS will keep the restored clean file and delete this incident quarantine folder. The log remains. The backup will not be changed.', incidentStatusAction(item.id, 'resolve'), 'Incident resolved and quarantine cleared.', 'Resolve'); }}>Resolve</button>
                              <button disabled={busy} className={`rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600${disabledButtonClass}`} onClick={(event) => { event.stopPropagation(); askConfirm('Mark this incident as false positive?', 'WARDS will restore the quarantined file as an authorized change, update the backup, and delete the quarantine folder. The log remains.', incidentStatusAction(item.id, 'false-positive'), 'Incident marked as false positive and authorized file restored. Staying on Security Incidents for review.', 'False+'); }}>False+</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <PaginationFooter state={historyPages.incidents} onPage={refreshIncidents} />
            </Section>
          )}

          {activeTab === 'Manual Controls' && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Section title="Integrity and Recovery">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <button disabled={busy} className={buttonStyles.neutral} onClick={() => askConfirm('Manual system scan?', 'WARDS will scan every monitored file and create logs for any changes it finds.', () => api.post('/security/scan'), (result) => result?.data?.summary || 'Full system integrity scan complete.', 'Start scan')}>Manual System Scan</button>
                  <button disabled={busy} className={buttonStyles.primary} onClick={() => askConfirm('Full system backup?', 'WARDS will back up VM1 database and all VM2 components (database, files, ML).', () => api.post('/security/backup/full'), 'Full system backup created.', 'Full backup')}>Full System Backup</button>
                  <button
                    disabled={busy}
                    className={buttonStyles.danger}
                    onClick={() => askConfirm('Full system recovery?', 'Are you sure you want to manually restore the system while it is deployed? You will be logged out.', async () => {
                          await api.post('/security/recover/full');
                          localStorage.removeItem('adminToken');
                          localStorage.removeItem('adminUser');
                          localStorage.removeItem('securityAuthenticated');
                          sessionStorage.removeItem('securityAuthenticated');
                          sessionStorage.removeItem('securityAuthenticatedAt');
                          navigate('/admin/backup/login');
                          return { skipRefresh: true };
                        }, 'Full system recovery complete.', 'Restore system')}
                  >
                    Full System Recovery
                  </button>
                </div>
              </Section>

              <Section title="Scheduled Backups">
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="datetime-local" min={toDateInputMin()} value={controls.backupDate} onChange={(e) => setControls({ ...controls, backupDate: e.target.value })} />
                    <button disabled={busy} className={buttonStyles.neutral} onClick={() => {
                      if (!controls.backupDate || new Date(controls.backupDate) <= new Date()) {
                        setNotice('Choose a future date and time for the scheduled backup.');
                        return;
                      }
                      askConfirm(
                        'Save automatic backup schedule?',
                        `WARDS will run weekly backups starting ${formatLocalDateTime(controls.backupDate)}.`,
                        () => api.post('/security/backup/schedule', { frequency: 'weekly', next_run: controls.backupDate }),
                        'Automatic backup schedule saved.',
                        'Save schedule',
                      );
                    }}>Schedule Automatic Backups</button>
                  </div>
                  <div className="grid gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Current backup location</p>
                      <p className="mt-1 break-all text-sm font-semibold text-slate-800">{showBackupPath ? (controls.backupPath || 'No folder selected yet.') : 'File path hidden for security.'}</p>
                    </div>
                    <button disabled={busy} className={buttonStyles.info} onClick={() => setShowBackupPath((value) => !value)}>{showBackupPath ? 'Hide file path' : 'Show file path'}</button>
                    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={controls.deletePrevious} onChange={(e) => setControls({ ...controls, deletePrevious: e.target.checked })} /> Delete backups from previous folder after changing location</label>
                    <button disabled={busy} className={buttonStyles.subtle} onClick={() => openFolderPicker('backup', 'Choose backup location', controls.backupPath)}>Backup Location</button>
                    <button
                      disabled={busy}
                      className={buttonStyles.neutral}
                      onClick={() => runAction(async () => {
                        const response = await refreshBackupInventory();
                        setShowBackupInventory(true);
                        return { ...response, skipRefresh: true };
                      }, 'Backup inventory loaded.', 'Loading backup inventory...')}
                    >
                      View backups
                    </button>
                  </div>
                </div>
              </Section>

              <Section title="Granular Backups">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <button disabled={busy} className={buttonStyles.neutral} onClick={() => askConfirm('Backup VM1 database?', 'WARDS will create a full dump of the VM1 business database.', () => api.post('/security/backup/vm1-database'), 'VM1 database backup created.', 'Backup VM1 DB')}>VM1 Database Backup</button>
                  <button disabled={busy} className={buttonStyles.neutral} onClick={() => askConfirm('Backup VM2 database?', 'WARDS will snapshot the VM2 security database.', () => api.post('/security/backup/vm2-database'), 'VM2 database backup created.', 'Backup VM2 DB')}>VM2 Database Backup</button>
                  <button disabled={busy} className={buttonStyles.neutral} onClick={() => askConfirm('Backup files?', 'WARDS will back up monitored WARDS and OCR files.', () => api.post('/security/backup/files'), 'Files backup created.', 'Backup files')}>Files Backup</button>
                  <button disabled={busy} className={buttonStyles.neutral} onClick={() => askConfirm('Backup ML artifacts?', 'WARDS will back up ML model state and metadata.', () => api.post('/security/backup/ml'), 'ML backup created.', 'Backup ML')}>ML Backup</button>
                </div>
              </Section>

              <Section title="Granular Recovery">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <button disabled={busy} className={buttonStyles.danger} onClick={() => askConfirm('Recover VM1 database?', 'Are you sure? This will restore the VM1 business database from the latest backup and log you out.', async () => { await api.post('/security/recover/vm1-database'); localStorage.removeItem('adminToken'); localStorage.removeItem('adminUser'); localStorage.removeItem('securityAuthenticated'); sessionStorage.removeItem('securityAuthenticated'); sessionStorage.removeItem('securityAuthenticatedAt'); navigate('/admin/backup/login'); return { skipRefresh: true }; }, 'VM1 database recovery complete.', 'Recover VM1 DB')}>VM1 Database Recovery</button>
                  <button disabled={busy} className={buttonStyles.danger} onClick={() => askConfirm('Recover VM2 database?', 'WARDS will restore the VM2 security database from the latest backup.', () => api.post('/security/recover/vm2-database'), 'VM2 database recovery complete.', 'Recover VM2 DB')}>VM2 Database Recovery</button>
                  <button disabled={busy} className={buttonStyles.danger} onClick={() => askConfirm('Recover files?', 'WARDS will restore monitored files from the latest backup.', () => api.post('/security/recover/files'), 'Files recovery complete.', 'Recover files')}>Files Recovery</button>
                  <button disabled={busy} className={buttonStyles.danger} onClick={() => askConfirm('Recover ML artifacts?', 'WARDS will restore ML model state from the latest backup.', () => api.post('/security/recover/ml'), 'ML recovery complete.', 'Recover ML')}>ML Recovery</button>
                </div>
              </Section>

              <Section title="Monitoring">
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-4 flex flex-col gap-3 rounded-xl bg-white p-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-900">Automatic deployment scans</p>
                        <p className="text-xs leading-5 text-slate-500">Current status: {controls.monitoringEnabled ? 'Enabled' : 'Disabled'}</p>
                      </div>
                      <button
                        disabled={busy}
                        className={controls.monitoringEnabled ? buttonStyles.warning : buttonStyles.success}
                        onClick={() => askConfirm(
                          controls.monitoringEnabled ? 'Turn off automatic scans?' : 'Turn on automatic scans?',
                          controls.monitoringEnabled
                            ? 'This is only recommended during development or deployment changes. While automatic scans are off, use manual scanning and manual backups to protect the system.'
                            : 'Before automatic scans resume, WARDS will first update the trusted backup with the current files. This prevents legitimate development changes made while scans were off from being logged as incidents.',
                          toggleMonitoring,
                          controls.monitoringEnabled
                            ? 'Automatic scans turned off.'
                            : (result) => result?.data?.backup_refreshed ? 'Automatic scans turned on after refreshing the trusted backup.' : 'Automatic scans turned on.',
                          controls.monitoringEnabled ? 'Turn off scans' : 'Turn on scans',
                        )}
                      >
                        {controls.monitoringEnabled ? 'Turn Off Automatic Scans' : 'Turn On Automatic Scans'}
                      </button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                      <label className="text-sm font-semibold text-slate-700">
                        Automatic file scan interval in seconds
                        <input
                          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                          type="number"
                          min="5"
                          max="3600"
                          value={controls.scanInterval}
                          onChange={(e) => setControls({ ...controls, scanInterval: e.target.value, scanIntervalDirty: true })}
                        />
                      </label>
                      <button disabled={busy} className={buttonStyles.neutral} onClick={() => askConfirm('Save scan interval?', `Automatic scans will run every ${Number(controls.scanInterval || 0)} seconds while monitoring is enabled.`, saveScanInterval, 'Automatic scan interval saved.', 'Save interval')}>Save Scan Interval</button>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">Default is 30 seconds. Lower values detect faster but use more backend resources.</p>
                  </div>
                </div>
              </Section>

              <Section title="AI Retraining">
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <CustomSelect value={controls.aiDay} onChange={(value) => setControls({ ...controls, aiDay: value })} options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((item) => ({ value: item, label: item }))} placeholder="Select day" />
                    <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="time" value={controls.aiTime} onChange={(e) => setControls({ ...controls, aiTime: e.target.value })} />
                    <button disabled={busy} className={buttonStyles.neutral} onClick={() => askConfirm('Save AI retraining schedule?', `WARDS will retrain the anomaly model every ${controls.aiDay} at ${controls.aiTime}.`, () => api.post('/security/ai/schedule', { day: controls.aiDay, time: controls.aiTime }), 'AI retraining schedule saved.', 'Save AI schedule')}>Scheduled AI Retrain</button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <button disabled={busy} className={`${buttonStyles.primary} w-full`} onClick={() => askConfirm('Retrain AI model?', 'WARDS will retrain using historical validated behavior and the newest verified activity.', () => api.post('/security/ai/retrain'), 'AI model retrained with historical and recent validated data.', 'Retrain AI')}>Manual AI Retrain</button>
                    <button disabled={busy} className={`${buttonStyles.neutral} w-full`} onClick={() => askConfirm('Seed initial AI training?', 'WARDS will use SECURITY/ml/initial_training_samples.csv to bootstrap the behavioral profile and Isolation Forest. This is skipped automatically after it succeeds once.', () => api.post('/security/ai/seed-initial-training'), (result) => result?.data?.status === 'skipped' ? 'Initial AI training was already seeded.' : 'Initial AI training seed completed.', 'Seed AI')}>Seed Initial Training</button>
                    <button disabled={busy} className={`${buttonStyles.subtle} w-full`} onClick={loadWeeklyAiData}>Show this week's data</button>
                  </div>
                  {weeklyAiData && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="font-bold text-slate-900">Behavior data since {formatDateTime(weeklyAiData.since)}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{weeklyAiData.summary}</p>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        <div className="rounded-lg bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">Approved changes</p><p className="text-lg font-bold">{weeklyAiData.admin_changes}</p></div>
                        <div className="rounded-lg bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">Admin users</p><p className="text-lg font-bold">{weeklyAiData.users}</p></div>
                        <div className="rounded-lg bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">Security reviews</p><p className="text-lg font-bold">{weeklyAiData.detections_reviewed}</p></div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {Object.entries(weeklyAiData.behaviors || {}).map(([label, count]) => (
                          <div key={label} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                            <span className="font-semibold text-slate-700">{titleize(label)}</span>
                            <span className="font-bold text-primary">{count}</span>
                          </div>
                        ))}
                      </div>
                      <details className="mt-3 rounded-lg bg-white p-3">
                        <summary className="cursor-pointer text-sm font-bold text-primary">Advanced view</summary>
                        <div className="mt-3 grid gap-3 xl:grid-cols-2">
                          <div>
                            <p className="mb-2 text-xs font-bold uppercase text-slate-500">Approved admin activity</p>
                            <div className="max-h-72 space-y-2 overflow-auto">
                              {(weeklyAiData.approved_changes || []).length ? weeklyAiData.approved_changes.map((item) => (
                                <div key={`change-${item.id}`} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700">
                                  <p className="font-bold text-slate-900">{item.file_path || 'Unknown file'}</p>
                                  <p>{formatDateTime(item.timestamp)} by Admin #{item.admin_id || 'unknown'}</p>
                                  <p>Action: {titleize(item.change_type)} - Source IP: {item.ip_address || 'not recorded'}</p>
                                </div>
                              )) : <p className="text-sm text-slate-500">No approved admin activity has been collected since the last retrain.</p>}
                            </div>
                          </div>
                          <div>
                            <p className="mb-2 text-xs font-bold uppercase text-slate-500">Security review data</p>
                            <div className="max-h-72 space-y-2 overflow-auto">
                              {(weeklyAiData.security_reviews || []).length ? weeklyAiData.security_reviews.map((item) => (
                                <div key={`review-${item.id}`} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700">
                                  <p className="font-bold text-slate-900">{item.target_name || 'Security event'}</p>
                                  <p>{formatDateTime(item.detected_at)} - {titleize(item.change_type)} - {titleize(item.severity)}</p>
                                  <p>AI result: {titleize(item.prediction)} - Confidence: {Math.round(Number(item.confidence || 0) * 100)}%</p>
                                  <p>Behaviors: {(item.behaviors || []).map(titleize).join(', ') || 'None recorded'}</p>
                                </div>
                              )) : <p className="text-sm text-slate-500">No security review data has been collected since the last retrain.</p>}
                            </div>
                          </div>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              </Section>

              <Section
                title="Behavioral Anomaly Rules"
                actions={(
                  <button disabled={busy} className={buttonStyles.neutral} onClick={() => setShowAiRules((value) => !value)}>
                    Manage AI Rules
                  </button>
                )}
              >
                <div className="space-y-4">
                  <p className="text-sm leading-6 text-slate-600">
                    Enable, disable, and configure the rules that feed the anomaly score. Global AI sensitivity controls the overall detection threshold across all rules.
                  </p>
                  {showAiRules ? (
                    <>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-sm font-bold text-slate-900">Global AI Sensitivity</p>
                            <p className="text-xs text-slate-500">Controls the overall detection threshold for all AI rules.</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <CustomSelect value={controls.aiSensitivity} onChange={(value) => setControls({ ...controls, aiSensitivity: value })} options={[{ value: 'low', label: 'Low - 0.85 threshold' }, { value: 'medium', label: 'Medium - 0.70 threshold' }, { value: 'high', label: 'High - 0.55 threshold' }, { value: 'very_high', label: 'Very High - 0.40 threshold' }]} placeholder="Select sensitivity" />
                            <button disabled={busy} className={buttonStyles.neutral} onClick={() => askConfirm('Save AI sensitivity?', 'WARDS will update the global AI sensitivity threshold used by anomaly scoring.', saveAiSensitivity, 'Global AI sensitivity saved.', 'Save sensitivity')}>Save</button>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                        <p className="text-sm font-bold text-blue-950">Add approved defacement rule</p>
                        <p className="mt-1 text-xs leading-5 text-blue-900">Only predefined rules based on the defacement dictionary can be added, so every new rule stays compatible with the AI scoring model and receives initial sample patterns.</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                          <CustomSelect value={controls.aiRuleTemplate} onChange={(value) => setControls({ ...controls, aiRuleTemplate: value })} options={[{ value: '', label: 'Select an approved rule' }, ...aiRuleTemplates.filter((item) => !item.already_added).map((item) => ({ value: item.key, label: item.label }))]} placeholder="Select an approved rule" />
                          <button disabled={busy} className={buttonStyles.primary} onClick={() => askConfirm('Add AI rule?', 'WARDS will add this approved rule to anomaly scoring with its initial sample configuration.', addSelectedAiRule, 'AI rule added with initial samples.', 'Add rule')}>Add AI Rule</button>
                        </div>
                      </div>
                      <div className="grid gap-3">
                        {Object.entries(aiRules).map(([key, rule]) => (
                          <div key={key} className="rounded-xl border border-slate-200 p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <label className="flex items-start gap-3">
                                <input className="mt-1" type="checkbox" checked={Boolean(rule.enabled)} onChange={(e) => updateRule(key, { enabled: e.target.checked })} />
                                <span>
                                  <span className="block font-bold text-slate-900">{key.replaceAll('_', ' ')}</span>
                                  <span className="mt-1 block text-sm text-slate-600">{rule.description || ruleHelp[key]}</span>
                                </span>
                              </label>
                            </div>
                            <details className="mt-3">
                              <summary className="cursor-pointer text-sm font-bold text-primary">Advanced configuration</summary>
                              <textarea
                                className="mt-3 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs"
                                value={rule.configText || '{}'}
                                onChange={(e) => updateRule(key, { configText: e.target.value })}
                              />
                            </details>
                          </div>
                        ))}
                      </div>
                      <button disabled={busy} className={`${buttonStyles.primary} w-full`} onClick={() => askConfirm('Save AI rules?', 'WARDS will update the enabled rules and advanced rule configuration used by anomaly scoring.', saveAiRules, 'AI behavioral rules saved.', 'Save rules')}>Save AI Rules</button>
                    </>
                  ) : (
                    <button disabled={busy} className={buttonStyles.info} onClick={() => setShowAiRules(true)}>
                      Open Manage AI Rules
                    </button>
                  )}
                </div>
              </Section>

              <Section title="Blocked IPs">
                <div className="space-y-4">
                  <p className="text-sm leading-6 text-slate-600">
                    View permanent IP blocks and manage account-based temporary restrictions. Rate-limit enforcement now targets accounts instead of shared IP addresses.
                  </p>
                  
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="mb-3 text-sm font-bold text-slate-900">Temporary User Restriction</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" placeholder="Account ID" value={restrictionInput.account_id} onChange={(e) => setRestrictionInput({ ...restrictionInput, account_id: e.target.value })} />
                      <CustomSelect value={restrictionInput.account_type} onChange={(value) => setRestrictionInput({ ...restrictionInput, account_type: value })} options={[{ value: 'citizen', label: 'Citizen' }, { value: 'branch', label: 'Branch Admin' }, { value: 'admin', label: 'Main Admin' }, { value: 'superadmin', label: 'Super Admin' }]} placeholder="Select account type" />
                      <CustomSelect value={restrictionInput.scope} onChange={(value) => setRestrictionInput({ ...restrictionInput, scope: value })} options={[{ value: 'manual', label: 'Manual' }, { value: 'general', label: 'General' }, { value: 'search', label: 'Search' }, { value: 'registration', label: 'Registration' }, { value: 'admin_general', label: 'Admin General' }, { value: 'password_reset', label: 'Password Reset' }]} placeholder="Select scope" />
                      <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" type="number" min="60" max="604800" placeholder="Duration (seconds)" value={restrictionInput.duration} onChange={(e) => setRestrictionInput({ ...restrictionInput, duration: e.target.value })} />
                      <button disabled={busy} className={`w-full whitespace-nowrap rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700${disabledButtonClass}`} onClick={() => askConfirm('Temporarily restrict this account?', `WARDS will restrict ${restrictionInput.account_type}:${restrictionInput.account_id || 'the entered account'} for ${restrictionInput.duration} seconds.`, restrictUser, 'Temporary user restriction added.', 'Restrict user')}>Restrict User</button>
                    </div>
                    <input className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Reason" value={restrictionInput.reason} onChange={(e) => setRestrictionInput({ ...restrictionInput, reason: e.target.value })} />
                  </div>

                  <div className="max-h-60 overflow-x-auto rounded-xl border border-slate-200 bg-white md:overflow-auto">
                    {userRestrictions.length > 0 ? (
                      <table className="w-full text-left text-sm min-w-[28rem]">
                        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Account</th>
                            <th className="px-4 py-3">Scope</th>
                            <th className="px-4 py-3">Remaining</th>
                            <th className="px-4 py-3">Strikes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {userRestrictions.map((item) => (
                            <tr key={`${item.account_id}-${item.scope}`} className="hover:bg-slate-50/60 transition">
                              <td className="px-4 py-3 font-mono text-xs text-slate-900">{item.account_id}</td>
                              <td className="px-4 py-3 text-slate-700">{item.scope}</td>
                              <td className="px-4 py-3 text-slate-700">{Math.floor(item.remaining_seconds / 60)}m {item.remaining_seconds % 60}s</td>
                              <td className="px-4 py-3 text-slate-700">{item.strike_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <div className="p-8 text-center text-sm text-slate-500">No account restrictions are active.</div>}
                  </div>

                  {blockedIps.filter((item) => !item.is_permanent).length > 0 && (
                    <div className="max-h-80 overflow-x-auto rounded-xl border border-slate-200 bg-white md:overflow-auto">
                      <table className="w-full text-left text-sm min-w-[28rem]">
                        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                          <tr>
                            <th className="px-4 py-3">IP Address</th>
                            <th className="px-4 py-3">Remaining Time</th>
                            <th className="px-4 py-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {blockedIps.filter((item) => !item.is_permanent).map((item) => (
                            <tr key={item.ip} className="hover:bg-slate-50/60 transition">
                              <td className="px-4 py-3 font-mono text-xs text-slate-900">{item.ip}</td>
                              <td className="px-4 py-3 text-slate-700">
                                {item.remaining_seconds > 0 ? `${Math.floor(item.remaining_seconds / 60)}m ${item.remaining_seconds % 60}s` : 'Expired'}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  disabled={busy}
                                  className={`rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-green-700 disabled:opacity-60${disabledButtonClass}`}
                                  onClick={() => askConfirm('Unblock this IP?', `WARDS will remove ${item.ip} from the temporary and active block lists.`, () => unblockIp(item.ip), `IP ${item.ip} unblocked.`, 'Unblock IP')}
                                >
                                  Unblock
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-orange-900">Permanent Blocklist</p>
                        <p className="text-xs text-orange-700">Manage long-term IP blocks for repeat offenders.</p>
                      </div>
                      <button
                        disabled={busy}
                        className={`rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white${disabledButtonClass}`}
                        onClick={() => setShowPermanentBlocks((value) => !value)}
                      >
                        {showPermanentBlocks ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>

                  {showPermanentBlocks && (
                    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <div>
                          <label className="text-sm font-semibold text-slate-700">IP Address</label>
                          <input
                            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            type="text"
                            placeholder="e.g., 192.168.1.100"
                            value={permanentBlockInput}
                            onChange={(e) => setPermanentBlockInput(e.target.value)}
                          />
                        </div>
                        <div className="flex items-end">
                          <button disabled={busy} className={`rounded-xl bg-red-700 px-4 py-2 font-semibold text-white${disabledButtonClass}`} onClick={() => askConfirm('Permanently block this IP?', `Only manual controls can create permanent blocks. WARDS will permanently block ${permanentBlockInput || 'the entered IP'} until an admin removes it.`, addPermanentBlock, 'Permanent IP block added.', 'Permanent block')}>
                            Add Permanent Block
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Reason</label>
                        <input
                          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                          type="text"
                          placeholder="e.g., Repeat brute force attacks"
                          value={permanentBlockReason}
                          onChange={(e) => setPermanentBlockReason(e.target.value)}
                        />
                      </div>

                      <div className="max-h-60 overflow-x-auto rounded-xl border border-slate-200 bg-white md:overflow-auto">
                        {permanentBlocks.length > 0 ? (
                          <table className="w-full text-left text-sm min-w-[28rem]">
                            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                              <tr>
                                <th className="px-4 py-3">IP Address</th>
                                <th className="px-4 py-3">Reason</th>
                                <th className="px-4 py-3">Blocked By</th>
                                <th className="px-4 py-3 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {permanentBlocks.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-50/60 transition">
                                  <td className="px-4 py-3 font-mono text-xs text-slate-900">{item.ip}</td>
                                  <td className="px-4 py-3 text-slate-700">{item.reason}</td>
                                  <td className="px-4 py-3 text-slate-700">{item.blocked_by}</td>
                                  <td className="px-4 py-3 text-right">
                                    <button
                                      disabled={busy}
                                      className={`rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60${disabledButtonClass}`}
                                      onClick={() => askConfirm('Remove permanent IP block?', `WARDS will remove ${item.ip} from the manual permanent blocklist.`, () => removePermanentBlock(item.ip), `IP ${item.ip} removed from permanent blocklist.`, 'Remove block')}
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="p-8 text-center text-sm text-slate-500">No permanent blocks.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            </div>
          )}
        </main>
        </div>
      </div>
    </div>
  );
};

export default BackupRecovery;
