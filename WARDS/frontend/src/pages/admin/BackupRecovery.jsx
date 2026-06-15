import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import wardsLogo from '../../assets/branding/wards_logo.png';
import qcLogo from '../../assets/branding/qclogo_main.png';
import galasLogo from '../../assets/branding/galas_logo.png';

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
const FILE_PAGE_SIZE = 10;

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

const Section = ({ title, children, actions }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {actions}
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
        <div key={label} className="grid grid-cols-[8rem_1fr_2rem] items-center gap-3 text-sm">
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

const Filters = ({ filters, setFilters, showType, showStatus, showClassification = false }) => (
  <div className="grid w-full gap-3 md:ml-auto md:w-[min(100%,64rem)] md:grid-cols-6">
    <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Search keyword" value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} />
    <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
    <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
    {showType ? (
      <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
        <option value="">All types</option>
        {showType.map((item) => <option key={item} value={item}>{titleize(item)}</option>)}
      </select>
    ) : showClassification ? (
      <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={filters.classification} onChange={(e) => setFilters({ ...filters, classification: e.target.value })}>
        <option value="">All classifications</option>
        <option value="malicious">Malicious</option>
        <option value="suspicious">Suspicious</option>
        <option value="legitimate">Legitimate</option>
      </select>
    ) : (
      <div />
    )}
    {showStatus ? (
      <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
        <option value="">All statuses</option>
        {showStatus.map((item) => <option key={item} value={item}>{titleize(item)}</option>)}
      </select>
    ) : (
      <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value })}>
        <option value="">All severities</option>
        {severities.map((item) => <option key={item} value={item}>{titleize(item)}</option>)}
      </select>
    )}
    <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={filters.sort || 'newest'} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
      {sortOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
  </div>
);

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

const BackupRecovery = () => {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [files, setFiles] = useState([]);
  const [detections, setDetections] = useState([]);
  const [recoveries, setRecoveries] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [backups, setBackups] = useState([]);
  const [historyPages, setHistoryPages] = useState({
    backups: { page: 1, page_size: 10, total: 0, total_pages: 1 },
    detections: { page: 1, page_size: 10, total: 0, total_pages: 1 },
    recoveries: { page: 1, page_size: 10, total: 0, total_pages: 1 },
    incidents: { page: 1, page_size: 10, total: 0, total_pages: 1 },
  });
  const historyPagesRef = useRef(historyPages);
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
    const response = await api.get('/security/permanent-blocks');
    setPermanentBlocks(response.data?.permanent_blocks || []);
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
    await api.post('/security/user-restrictions', { ...restrictionInput, account_id: restrictionInput.account_id.trim(), duration: Number(restrictionInput.duration || 900) });
    setNotice(`Temporary restriction applied to ${restrictionInput.account_type}:${restrictionInput.account_id.trim()}.`);
    setRestrictionInput((current) => ({ ...current, account_id: '' }));
    await refreshUserRestrictions();
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
      await api.post('/security/permanent-blocks', { ip: permanentBlockInput.trim(), reason: permanentBlockReason.trim() });
      setNotice(`IP ${permanentBlockInput.trim()} permanently blocked.`);
      setPermanentBlockInput('');
      setPermanentBlockReason('');
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
      await refreshAiRules();
      await refreshAiSensitivity();
      await refreshBlockedIps();
      await refreshPermanentBlocks();
      await refreshUserRestrictions();
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
      if (activeTab === 'File Status') refreshFiles();
      if (activeTab === 'Detection History') refreshDetections();
      if (activeTab === 'Recovery History') refreshRecoveries();
      if (activeTab === 'Security Incidents') refreshIncidents();
      if (activeTab === 'Backup History') refreshBackups();
    }, 3000);
    return () => clearInterval(timer);
  }, [activeTab, detectionFilters, recoveryFilters, incidentFilters, backupFilters]);

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
    if (tab === 'Detection History') markAllSeen('detections');
    if (tab === 'Recovery History') markAllSeen('recoveries');
    if (tab === 'Backup History') markAllSeen('backups');
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

  const missingFileParams = (options) => (options?.confirmMissingFiles ? { params: { confirm_missing_files: true } } : undefined);

  const bulkIncidentAction = (action) => (options = {}) => api.patch('/security/incidents/bulk-action', { action, confirm_missing_files: Boolean(options.confirmMissingFiles) });

  const incidentStatusAction = (incidentId, actionPath) => (options = {}) => api.patch(`/security/incidents/${incidentId}/${actionPath}`, null, missingFileParams(options));

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
    return api.put('/security/scan-interval', { seconds }).then((response) => { setControls((current) => ({ ...current, scanInterval: String(seconds), scanIntervalDirty: false })); return response; });
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
        `WARDS will use ${path} for new trusted backups. The selected folder must be empty so existing files are not mixed with security backups.`,
        () => api.post('/security/backup/location', { path, delete_previous: controls.deletePrevious }),
        'Backup location updated.',
        'Save location',
      );
      return;
    }
    if (folderPicker.mode === 'add-monitor') {
      setControls((current) => ({ ...current, monitoredFolder: path }));
      askConfirm('Add monitored folder?', `WARDS will add ${path} to file monitoring, file status, and local backups.`, () => api.post('/security/folders', { path }), 'Monitored folder added.', 'Add folder');
      return;
    }
    if (folderPicker.mode === 'remove-monitor') {
      askConfirm('Remove monitored folder?', `WARDS will remove ${path} from monitoring, file status, and local backup copies.`, () => api.post('/security/folders/remove', { path }), 'Monitored folder removed from monitoring and local backups.', 'Remove folder');
    }
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
        const result = typeof leftValue === 'number'
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
        return fileSort.direction === 'asc' ? result : -result;
      });
  }, [files, fileKeyword, fileSort]);

  const cardClass = (label, value) => {
    if (label === 'System Status') return String(value).toLowerCase() === 'protected' ? 'bg-green-600 text-white' : 'bg-orange-500 text-white';
    if (label === 'Active Incidents') return Number(value || 0) === 0 ? 'bg-green-400 text-white' : 'bg-orange-300 text-white';
    if (label === 'Monitored Files') return 'bg-yellow-500 text-white';
    return 'bg-blue-600 text-white';
  };

  return (
    <div className="min-h-screen bg-lightbg">
      <ConfirmModal confirm={confirm} onCancel={() => setConfirm(null)} onConfirm={handleConfirm} busy={busy} />
      <FolderPicker
        picker={folderPicker}
        onClose={closeFolderPicker}
        onSelect={selectFolder}
        onOpen={(path) => openFolderPicker(folderPicker.mode, folderPicker.title, path)}
      />
      <nav className="fixed left-0 right-0 top-0 z-40 h-16 bg-primary px-6 shadow-lg">
        <div className="flex h-full items-center justify-between">
          <div className="flex items-center gap-3">
            {[wardsLogo, qcLogo, galasLogo].map((logo, index) => (
              <div key={index} className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white/10 ring-1 ring-white/20">
                <img src={logo} alt="Client logo" className="h-full w-full object-contain p-1" />
              </div>
            ))}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-100">WARDS Backup & Recovery</p>
              <h1 className="text-lg font-bold text-white">Security Dashboard</h1>
            </div>
          </div>
          <button onClick={returnToAdmin} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-primary transition hover:bg-blue-50">
            Return to {isSuperadmin ? 'superadmin' : 'admin'} dashboard
          </button>
        </div>
      </nav>

      <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-72 overflow-y-auto border-r border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-5 rounded-xl bg-purple-100 p-4 text-center text-purple-800">
          <p className="text-sm font-bold">{adminLabel}</p>
        </div>
        <div className="space-y-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => changeTab(tab)}
              className={`w-full rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${activeTab === tab ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              <span>{tab}</span>
              {notificationCounts[tab] > 0 && (
                <span className="float-right rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{notificationCounts[tab]}</span>
              )}
            </button>
          ))}
        </div>
      </aside>

      <main className="ml-72 pt-16">
        <div className="space-y-6 p-8">
          <section className="rounded-[2rem] border border-slate-300 bg-white px-8 py-7 text-slate-900 shadow-2xl shadow-slate-200/60">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="max-w-3xl text-sm leading-6 text-slate-600">
                  Local backup, Wazuh-fed monitoring, AI anomaly detection, quarantine, and recovery controls for the WARDS and OCR folders.
                </p>
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                {cards.map(([label, value]) => (
                  <div key={label} className={`rounded-2xl p-5 shadow-sm ${cardClass(label, value)}`}>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">{label}</p>
                    <p className="mt-3 break-words text-2xl font-bold text-white">{value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                  {Object.entries(dashboard?.health || {}).filter(([key]) => key !== 'backup_location').map(([key, value]) => (
                    <div key={key} className="min-w-0 rounded-xl border border-green-100 bg-green-50/80 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-green-700">{key.replaceAll('_', ' ')}</p>
                      <p className="mt-2 overflow-hidden break-words text-sm font-bold text-green-900">{value}</p>
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
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm md:w-80"
                  placeholder="Search files by keyword"
                  value={fileKeyword}
                  onChange={(e) => setFileKeyword(e.target.value)}
                />
              )}
            >
              <div className="overflow-x-auto md:overflow-hidden">
                <table className="w-full text-left text-sm min-w-[600px]">
                  <thead className="border-b text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="py-3">File</th>
                      <th><SortHeader label="Folder" column="folder" sort={fileSort} setSort={setFileSort} /></th>
                      <th><SortHeader label="Status" column="status" sort={fileSort} setSort={setFileSort} /></th>
                      <th><SortHeader label="Type" column="type" sort={fileSort} setSort={setFileSort} /></th>
                      <th><SortHeader label="Size" column="size" sort={fileSort} setSort={setFileSort} /></th>
                      <th><SortHeader label="Last Checked" column="last_checked" sort={fileSort} setSort={setFileSort} /></th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleFiles.slice((filePage - 1) * FILE_PAGE_SIZE, filePage * FILE_PAGE_SIZE).map((file) => (
                      <tr key={file.id}>
                        <td className="max-w-md py-3 font-semibold text-slate-800">{file.relative_path}</td>
                        <td>{file.folder_root}</td>
                        <td><Badge>{file.status}</Badge></td>
                        <td>{file.file_type}</td>
                        <td>{Number(file.size_bytes || 0).toLocaleString()} B</td>
                        <td>{file.last_checked ? new Date(file.last_checked).toLocaleString() : 'n/a'}</td>
                        <td className="flex gap-2 py-2">
                          <button disabled={busy} className={`rounded-lg bg-slate-100 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-200${disabledButtonClass}`} onClick={() => runAction(() => api.post(`/security/files/${file.id}/scan`), (result) => result?.data?.detection ? `Changes found in ${file.relative_path}. Detection log created.` : `No changes found in ${file.relative_path}.`, `Scanning ${file.relative_path}...`)}>Scan</button>
                          <button disabled={busy} className={`rounded-lg bg-primary px-3 py-2 font-semibold text-white hover:bg-blue-900${disabledButtonClass}`} onClick={() => askConfirm('Recover this file from backup?', `This will restore ${file.relative_path} from the trusted local backup. There may be file or path mismatches if the file was moved, renamed, or backed up before recent structural changes. A full system backup is still recommended before relying on individual file recovery.`, () => api.post(`/security/files/${file.id}/recover`), 'File recovery complete.', 'Recover file')}>Recover</button>
                        </td>
                      </tr>
                    ))}
                    {!visibleFiles.length && (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-sm font-semibold text-slate-500">No monitored files match your search.</td>
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
                    <div key={item.id} className="relative rounded-xl border border-slate-200 bg-white p-4">
                      {unseen && <span className="absolute right-3 top-3 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">New</span>}
                      <button className="grid w-full gap-3 pr-12 text-left md:grid-cols-[minmax(0,1fr)_auto] md:items-center" onClick={() => toggleBackupRow(key, item.id)}>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">{item.summary || 'Backup completed'}</p>
                          <p className="text-sm text-slate-600">{formatDateTime(item.started_at)}</p>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end md:text-right">
                          <span className="max-w-xs truncate text-sm font-semibold text-slate-600">{item.backup_path || 'No path recorded'}</span>
                          <Badge>{item.recovery_type}</Badge>
                          <Badge>{item.status}</Badge>
                        </div>
                      </button>
                      {openRows[key] && (
                        <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(item, null, 2)}</pre>
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
                    <div key={item.id} className="relative rounded-xl border border-slate-200 bg-white p-4">
                      {unseen && <span className="absolute right-3 top-3 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">New</span>}
                      <button className="grid w-full gap-3 pr-12 text-left md:grid-cols-[minmax(0,1fr)_auto] md:items-center" onClick={() => toggleDetectionRow(key, item.id)}>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">{item.target_name}</p>
                          <p className="text-sm text-slate-600">{item.trigger_summary}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(item.detected_at)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end md:text-right">
                          <span className="text-sm font-semibold text-slate-600">{Math.round(Number(item.confidence || 0) * 100)}% confidence</span>
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
                          <pre className="max-h-64 overflow-auto rounded-xl bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(item.changed_lines, null, 2)}</pre>
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
                    <div key={item.id} className="relative rounded-xl border border-slate-200 bg-white p-4">
                      {unseen && <span className="absolute right-3 top-3 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">New</span>}
                      <button className="grid w-full gap-3 pr-12 text-left md:grid-cols-[minmax(0,1fr)_auto] md:items-center" onClick={() => toggleRecoveryRow(key, item.id)}>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">{item.summary || item.recovery_type}</p>
                          <p className="text-sm text-slate-600">{formatDateTime(item.started_at)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end md:text-right">
                          <span className="text-sm font-semibold text-slate-600">{item.recovery_duration_ms || 0} ms</span>
                          <Badge>{item.recovery_type}</Badge>
                          <Badge>{item.status}</Badge>
                        </div>
                      </button>
                      {openRows[key] && (
                        <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(item, null, 2)}</pre>
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                  <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Search incidents" value={incidentFilters.keyword} onChange={(e) => setIncidentFilters({ ...incidentFilters, keyword: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="date" value={incidentFilters.date_from} onChange={(e) => setIncidentFilters({ ...incidentFilters, date_from: e.target.value })} />
                  <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="date" value={incidentFilters.date_to} onChange={(e) => setIncidentFilters({ ...incidentFilters, date_to: e.target.value })} />
                  <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={incidentFilters.status} onChange={(e) => setIncidentFilters({ ...incidentFilters, status: e.target.value })}>
                    <option value="">All statuses</option>
                    {['open', 'investigating', 'resolved', 'false_positive'].map((item) => <option key={item} value={item}>{badgeText(item)}</option>)}
                  </select>
                  <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={incidentFilters.severity} onChange={(e) => setIncidentFilters({ ...incidentFilters, severity: e.target.value })}>
                    <option value="">All severities</option>
                    {severities.map((item) => <option key={item} value={item}>{titleize(item)}</option>)}
                  </select>
                  <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={incidentFilters.sort} onChange={(e) => setIncidentFilters({ ...incidentFilters, sort: e.target.value })}>
                    {sortOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </div>
              }
            >
              <div className="mb-4 flex flex-wrap gap-2">
                <button disabled={busy} className={`rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white${disabledButtonClass}`} onClick={() => askConfirm('Mark all unresolved incidents as resolved?', 'This will close every open or investigating incident and delete their quarantine folders. Logs will remain. The backup will not be changed because resolved incidents keep the current clean files.', bulkIncidentAction('resolve'), 'All unresolved incidents marked as resolved.', 'Resolve all')}>Mark all as resolved</button>
                <button disabled={busy} className={`rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white${disabledButtonClass}`} onClick={() => askConfirm('Mark all unresolved incidents as false positives?', 'This will accept every open or investigating quarantined file as authorized, update the backup, and delete quarantine folders. Logs will remain.', bulkIncidentAction('false_positive'), 'All unresolved incidents marked as false positive.', 'Mark all False+')}>Mark all as False+</button>
                <button disabled={busy} className={`rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white${disabledButtonClass}`} onClick={() => askConfirm('Mark all open incidents as investigating?', 'This will move every open incident into investigating status so your team can review them. No files will be restored or deleted.', bulkIncidentAction('investigating'), 'All open incidents marked as investigating.', 'Mark investigating')}>Mark all as investigating</button>
              </div>
              <div className="space-y-3">
                {incidents.map((item) => {
                  const key = `i-${item.id}`;
                  const unresolved = ['open', 'investigating'].includes(String(item.status).toLowerCase());
                  return (
                    <div key={item.id} className="relative rounded-xl border border-slate-200 bg-white p-4">
                      {unresolved && <span className="absolute right-3 top-3 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">Open</span>}
                      <button className="grid w-full gap-3 pr-12 text-left md:grid-cols-[minmax(0,1fr)_auto] md:items-center" onClick={() => toggleRow(key)}>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">{titleize(item.incident_type)}</p>
                          <p className="text-sm text-slate-600">{item.description}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(item.created_at)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end md:text-right">
                          <span className="text-sm font-bold text-slate-700">CVSS {item.cvss_score}</span>
                          <Badge>{item.severity_level}</Badge>
                          <Badge>{item.status}</Badge>
                        </div>
                      </button>
                      {openRows[key] && (
                        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-500">NIST</p><p className="mt-1 text-sm font-semibold">{item.nist_category}</p></div>
                            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-500">ENISA</p><p className="mt-1 text-sm font-semibold">{item.enisa_threat_type}</p></div>
                            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-500">Action</p><p className="mt-1 text-sm font-semibold">{item.response_action}</p></div>
                          </div>
                          <p className="text-sm text-slate-700"><strong>Behaviors:</strong> {(item.behaviors || []).map(humanize).join(', ') || 'None'}</p>
                          <p className="text-sm text-slate-700"><strong>Affected files:</strong> {(item.affected_files || []).join(', ') || 'None'}</p>
                          <pre className="max-h-64 overflow-auto rounded-xl bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(item.changed_lines, null, 2)}</pre>
                          {unresolved && (
                            <div className="flex flex-wrap gap-2">
                              <button disabled={busy} className={`rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700${disabledButtonClass}`} onClick={(event) => { event.stopPropagation(); askConfirm('Resolve this incident?', 'WARDS will keep the restored clean file and delete this incident quarantine folder. The log remains. The backup will not be changed.', incidentStatusAction(item.id, 'resolve'), 'Incident resolved and quarantine cleared.', 'Resolve'); }}>Resolve</button>
                              <button disabled={busy} className={`rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600${disabledButtonClass}`} onClick={(event) => { event.stopPropagation(); askConfirm('Mark this incident as false positive?', 'WARDS will restore the quarantined file as an authorized change, update the backup, and delete the quarantine folder. The log remains.', incidentStatusAction(item.id, 'false-positive'), 'Incident marked as false positive and authorized file restored. Staying on Security Incidents for review.', 'False+'); }}>False+</button>
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <button disabled={busy} className="rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-60" onClick={() => askConfirm('Manual system scan?', 'WARDS will scan every monitored file and create logs for any changes it finds.', () => api.post('/security/scan'), (result) => result?.data?.summary || 'Full system integrity scan complete.', 'Start scan')}>Manual System Scan</button>
                  <button
                    disabled={busy}
                    className="rounded-xl bg-red-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
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

              <Section title="Backups">
                <div className="space-y-3">
                  <button disabled={busy} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-60" onClick={() => askConfirm('Create manual backup?', 'WARDS will replace the latest trusted local backup with the current monitored files.', () => api.post('/security/backup/manual'), 'Manual local backup completed.', 'Create backup')}>Manual Backup</button>
                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="datetime-local" min={toDateInputMin()} value={controls.backupDate} onChange={(e) => setControls({ ...controls, backupDate: e.target.value })} />
                    <button disabled={busy} className={`rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white${disabledButtonClass}`} onClick={() => {
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
                    <button disabled={busy} className={`rounded-xl bg-blue-50 px-4 py-3 font-semibold text-primary${disabledButtonClass}`} onClick={() => setShowBackupPath((value) => !value)}>{showBackupPath ? 'Hide file path' : 'Show file path'}</button>
                    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={controls.deletePrevious} onChange={(e) => setControls({ ...controls, deletePrevious: e.target.checked })} /> Delete backups from previous folder after changing location</label>
                    <button disabled={busy} className={`rounded-xl bg-slate-100 px-4 py-3 font-semibold text-slate-800${disabledButtonClass}`} onClick={() => openFolderPicker('backup', 'Choose backup location', controls.backupPath)}>Backup Location</button>
                  </div>
                </div>
              </Section>

              <Section title="Monitoring">
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Last selected folder</p>
                    <p className="mt-1 break-all text-sm font-semibold text-slate-800">{controls.monitoredFolder || 'No extra monitored folder selected yet.'}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <button disabled={busy} className={`rounded-xl bg-primary px-4 py-3 font-semibold text-white${disabledButtonClass}`} onClick={() => openFolderPicker('add-monitor', 'Add monitored folder', controls.monitoredFolder)}>Add monitored folder</button>
                    <button disabled={busy} className={`rounded-xl bg-red-50 px-4 py-3 font-semibold text-red-700${disabledButtonClass}`} onClick={() => openFolderPicker('remove-monitor', 'Remove monitored folder', controls.monitoredFolder)}>Remove monitored folder</button>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-4 flex flex-col gap-3 rounded-xl bg-white p-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-900">Automatic deployment scans</p>
                        <p className="text-xs leading-5 text-slate-500">Current status: {controls.monitoringEnabled ? 'Enabled' : 'Disabled'}</p>
                      </div>
                      <button
                        disabled={busy}
                        className={`rounded-xl px-4 py-3 font-semibold text-white ${controls.monitoringEnabled ? 'bg-orange-500' : 'bg-green-600'}${disabledButtonClass}`}
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
                      <button disabled={busy} className={`rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white${disabledButtonClass}`} onClick={() => askConfirm('Save scan interval?', `Automatic scans will run every ${Number(controls.scanInterval || 0)} seconds while monitoring is enabled.`, saveScanInterval, 'Automatic scan interval saved.', 'Save interval')}>Save Scan Interval</button>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">Default is 30 seconds. Lower values detect faster but use more backend resources.</p>
                  </div>
                </div>
              </Section>

              <Section title="AI Retraining">
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={controls.aiDay} onChange={(e) => setControls({ ...controls, aiDay: e.target.value })}>
                      {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="time" value={controls.aiTime} onChange={(e) => setControls({ ...controls, aiTime: e.target.value })} />
                    <button disabled={busy} className={`rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white${disabledButtonClass}`} onClick={() => askConfirm('Save AI retraining schedule?', `WARDS will retrain the anomaly model every ${controls.aiDay} at ${controls.aiTime}.`, () => api.post('/security/ai/schedule', { day: controls.aiDay, time: controls.aiTime }), 'AI retraining schedule saved.', 'Save AI schedule')}>Scheduled AI Retrain</button>
                  </div>
                  <button disabled={busy} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-60" onClick={() => askConfirm('Retrain AI model?', 'WARDS will retrain using historical validated behavior and the newest verified activity.', () => api.post('/security/ai/retrain'), 'AI model retrained with historical and recent validated data.', 'Retrain AI')}>Manual AI Retrain</button>
                  <button disabled={busy} className={`w-full rounded-xl bg-slate-100 px-4 py-3 font-semibold text-slate-800${disabledButtonClass}`} onClick={loadWeeklyAiData}>Show this week's data</button>
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
                  <button disabled={busy} className={`rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white${disabledButtonClass}`} onClick={() => setShowAiRules((value) => !value)}>
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
                            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={controls.aiSensitivity} onChange={(e) => setControls({ ...controls, aiSensitivity: e.target.value })}>
                              <option value="low">Low - 0.85 threshold</option>
                              <option value="medium">Medium - 0.70 threshold</option>
                              <option value="high">High - 0.55 threshold</option>
                              <option value="very_high">Very High - 0.40 threshold</option>
                            </select>
                            <button disabled={busy} className={`rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white${disabledButtonClass}`} onClick={() => askConfirm('Save AI sensitivity?', 'WARDS will update the global AI sensitivity threshold used by anomaly scoring.', saveAiSensitivity, 'Global AI sensitivity saved.', 'Save sensitivity')}>Save</button>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                        <p className="text-sm font-bold text-blue-950">Add approved defacement rule</p>
                        <p className="mt-1 text-xs leading-5 text-blue-900">Only predefined rules based on the defacement dictionary can be added, so every new rule stays compatible with the AI scoring model and receives initial sample patterns.</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                          <select className="rounded-xl border border-blue-200 px-3 py-2 text-sm" value={controls.aiRuleTemplate} onChange={(e) => setControls({ ...controls, aiRuleTemplate: e.target.value })}>
                            <option value="">Select an approved rule</option>
                            {aiRuleTemplates.filter((item) => !item.already_added).map((item) => (
                              <option key={item.key} value={item.key}>{item.label}</option>
                            ))}
                          </select>
                          <button disabled={busy} className={`rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white${disabledButtonClass}`} onClick={() => askConfirm('Add AI rule?', 'WARDS will add this approved rule to anomaly scoring with its initial sample configuration.', addSelectedAiRule, 'AI rule added with initial samples.', 'Add rule')}>Add AI Rule</button>
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
                      <button disabled={busy} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-60" onClick={() => askConfirm('Save AI rules?', 'WARDS will update the enabled rules and advanced rule configuration used by anomaly scoring.', saveAiRules, 'AI behavioral rules saved.', 'Save rules')}>Save AI Rules</button>
                    </>
                  ) : (
                    <button disabled={busy} className={`rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-primary${disabledButtonClass}`} onClick={() => setShowAiRules(true)}>
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
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                      <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Account ID" value={restrictionInput.account_id} onChange={(e) => setRestrictionInput({ ...restrictionInput, account_id: e.target.value })} />
                      <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={restrictionInput.account_type} onChange={(e) => setRestrictionInput({ ...restrictionInput, account_type: e.target.value })}>
                        <option value="citizen">Citizen</option>
                        <option value="branch">Branch Admin</option>
                        <option value="admin">Main Admin</option>
                        <option value="superadmin">Super Admin</option>
                      </select>
                      <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Scope" value={restrictionInput.scope} onChange={(e) => setRestrictionInput({ ...restrictionInput, scope: e.target.value })} />
                      <input className="rounded-xl border border-slate-200 px-3 py-2 text-sm" type="number" min="60" max="604800" value={restrictionInput.duration} onChange={(e) => setRestrictionInput({ ...restrictionInput, duration: e.target.value })} />
                      <button disabled={busy} className={`rounded-xl bg-red-600 px-4 py-2 font-semibold text-white${disabledButtonClass}`} onClick={() => askConfirm('Temporarily restrict this account?', `WARDS will restrict ${restrictionInput.account_type}:${restrictionInput.account_id || 'the entered account'} for ${restrictionInput.duration} seconds.`, restrictUser, 'Temporary user restriction added.', 'Restrict user')}>Restrict User</button>
                    </div>
                    <input className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Reason" value={restrictionInput.reason} onChange={(e) => setRestrictionInput({ ...restrictionInput, reason: e.target.value })} />
                  </div>

                  <div className="max-h-60 overflow-x-auto rounded-xl border border-slate-200 md:overflow-auto">
                    {userRestrictions.length > 0 ? (
                      <table className="w-full text-sm min-w-[400px]">
                        <thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left font-bold text-slate-700">Account</th><th className="px-4 py-3 text-left font-bold text-slate-700">Scope</th><th className="px-4 py-3 text-left font-bold text-slate-700">Remaining</th><th className="px-4 py-3 text-left font-bold text-slate-700">Strikes</th></tr></thead>
                        <tbody>{userRestrictions.map((item) => <tr key={`${item.account_id}-${item.scope}`} className="border-t border-slate-100"><td className="px-4 py-3 font-mono text-slate-900">{item.account_id}</td><td className="px-4 py-3 text-slate-700">{item.scope}</td><td className="px-4 py-3 text-slate-700">{Math.floor(item.remaining_seconds / 60)}m {item.remaining_seconds % 60}s</td><td className="px-4 py-3 text-slate-700">{item.strike_count}</td></tr>)}</tbody>
                      </table>
                    ) : <div className="p-8 text-center text-sm text-slate-500">No account restrictions are active.</div>}
                  </div>

                  <div className="max-h-80 overflow-x-auto rounded-xl border border-slate-200 md:overflow-auto">
                    {blockedIps.length > 0 ? (
                      <table className="w-full text-sm min-w-[400px]">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left font-bold text-slate-700">IP Address</th>
                            <th className="px-4 py-3 text-left font-bold text-slate-700">Remaining Time</th>
                            <th className="px-4 py-3 text-right font-bold text-slate-700">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {blockedIps.map((item) => (
                            <tr key={item.ip} className="border-t border-slate-100">
                              <td className="px-4 py-3 font-mono text-slate-900">{item.ip}</td>
                              <td className="px-4 py-3 text-slate-700">
                                {item.is_permanent ? 'Permanent' : (item.remaining_seconds > 0 ? `${Math.floor(item.remaining_seconds / 60)}m ${item.remaining_seconds % 60}s` : 'Expired')}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  disabled={busy}
                                  className={`rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60${disabledButtonClass}`}
                                  onClick={() => askConfirm('Unblock this IP?', `WARDS will remove ${item.ip} from the temporary and active block lists.`, () => unblockIp(item.ip), `IP ${item.ip} unblocked.`, 'Unblock IP')}
                                >
                                  Unblock
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-8 text-center text-sm text-slate-500">No IP addresses are currently blocked.</div>
                    )}
                  </div>

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

                      <div className="max-h-60 overflow-x-auto rounded-xl border border-slate-200 md:overflow-auto">
                        {permanentBlocks.length > 0 ? (
                          <table className="w-full text-sm min-w-[400px]">
                            <thead className="bg-slate-50">
                              <tr>
                                <th className="px-4 py-3 text-left font-bold text-slate-700">IP Address</th>
                                <th className="px-4 py-3 text-left font-bold text-slate-700">Reason</th>
                                <th className="px-4 py-3 text-left font-bold text-slate-700">Blocked By</th>
                                <th className="px-4 py-3 text-right font-bold text-slate-700">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {permanentBlocks.map((item) => (
                                <tr key={item.id} className="border-t border-slate-100">
                                  <td className="px-4 py-3 font-mono text-slate-900">{item.ip}</td>
                                  <td className="px-4 py-3 text-slate-700">{item.reason}</td>
                                  <td className="px-4 py-3 text-slate-700">{item.blocked_by}</td>
                                  <td className="px-4 py-3 text-right">
                                    <button
                                      disabled={busy}
                                      className={`rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60${disabledButtonClass}`}
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
        </div>
      </main>
    </div>
  );
};

export default BackupRecovery;
