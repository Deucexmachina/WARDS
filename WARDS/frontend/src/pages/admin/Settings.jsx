import { useEffect, useMemo, useRef, useState } from 'react';
import { branchAPI, settingsAPI } from '../../services/api';
import { formatUtc8Date, formatUtc8Time } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';

const DEFAULT_PAGE_SIZE = 5;
const defaultSettings = {
  queueEnabled: true,
  maxQueuePerBranch: 100,
  maxQueuePerWindow: 25,
  queueTimeSlot: 15,
  enabledServices: [],
  paymentGatewayEnabled: true,
  receiptRequestEnabled: true,
  maintenanceMode: false,
  sessionTimeout: 30,
  maxLoginAttempts: 5,
};

const sectionDescription = {
  'Queue Operations': 'Control public queue access, limits, and timing defaults used across branch workflows.',
  Services: 'Define which services stay available to the public, including online payments and receipt copy requests.',
  'Authentication & Security': 'Apply security defaults for new sessions and login lockout behavior.',
  'Operational Defaults': 'Manage system-wide operational mode switches.',
};

const formatManilaDate = (value) => formatUtc8Date(value);
const formatManilaTime = (value) => formatUtc8Time(value);

const SERVICE_LABELS = {
  RPT: 'Real Property Tax',
  BUSINESS: 'Business Tax',
  MISC: 'Miscellaneous Tax',
  CTC: 'Community Tax Certificate',
  PTR: 'Professional Tax Receipt',
  MARKET: 'Market',
};

const normalizeServiceCode = (value) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  const alias = {
    'REAL PROPERTY TAX': 'RPT',
    REAL_PROPERTY_TAX: 'RPT',
    BT: 'BUSINESS',
    'BUSINESS TAX': 'BUSINESS',
    BUSINESS_TAX: 'BUSINESS',
    MISCELLANEOUS: 'MISC',
    'MISCELLANEOUS TAX': 'MISC',
    'COMMUNITY TAX CERTIFICATE': 'CTC',
    COMMUNITY_TAX_CERTIFICATE: 'CTC',
    'PROFESSIONAL TAX RECEIPT': 'PTR',
    PROFESSIONAL_TAX_RECEIPT: 'PTR',
  }[raw];
  if (alias) return alias;
  if (/^QW\d+$/.test(raw)) return raw;
  return raw.replace(/[^A-Z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
};

const getServiceLabel = (code) => {
  const normalized = normalizeServiceCode(code);
  if (!normalized) return 'Unassigned';
  if (SERVICE_LABELS[normalized]) return SERVICE_LABELS[normalized];
  if (/^QW\d+$/.test(normalized)) return `Window ${normalized.slice(2)}`;
  return normalized;
};

const getBranchWindowBadges = (branch) => {
  const windows = Array.isArray(branch?.window_accounts) ? branch.window_accounts : [];
  if (!windows.length) return [];
  return windows.map((account) => ({
    windowNumber: account.assigned_window_number || '—',
    code: normalizeServiceCode(account.service_window_label || account.service_window),
    active: account.is_verified && account.status === 'Active',
  }));
};

const showSystemSuccessMessage = ({ title, message }) => {
  window.dispatchEvent(new CustomEvent('wards:system-message', {
    detail: { tone: 'success', title, message, buttonLabel: 'OK' },
  }));
};

const Settings = () => {
  const [settings, setSettings] = useState(defaultSettings);
  const [serviceOptions, setServiceOptions] = useState([]);
  const [branches, setBranches] = useState([]);
  const [metadata, setMetadata] = useState({});
  const [historyState, setHistoryState] = useState({
    items: [], page: 1, page_size: DEFAULT_PAGE_SIZE, total: 0, total_pages: 1, categories: [],
  });
  const [historySearch, setHistorySearch] = useState('');
  const [historySearchDraft, setHistorySearchDraft] = useState('');
  const [historyCategory, setHistoryCategory] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState(null);
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [mfaError, setMfaError] = useState('');
  const [settingUpMfa, setSettingUpMfa] = useState(false);
  const savedSettings = useRef(null);
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');

  const fetchSettings = async () => {
    const settingsResponse = await settingsAPI.get();
    const settingsData = settingsResponse.data || {};
    const normalized = {
      queueEnabled: Boolean(settingsData.queueEnabled),
      maxQueuePerBranch: Number(settingsData.maxQueuePerBranch || 100),
      maxQueuePerWindow: Number(settingsData.maxQueuePerWindow || 25),
      queueTimeSlot: Number(settingsData.queueTimeSlot || 15),
      enabledServices: settingsData.enabledServices || [],
      paymentGatewayEnabled: Boolean(settingsData.paymentGatewayEnabled),
      receiptRequestEnabled: Boolean(settingsData.receiptRequestEnabled),
      maintenanceMode: Boolean(settingsData.maintenanceMode),
      sessionTimeout: Number(settingsData.sessionTimeout || 30),
      maxLoginAttempts: Number(settingsData.maxLoginAttempts || 5),
    };
    setSettings(normalized);
    savedSettings.current = normalized;
    setMetadata(settingsData.metadata || {});
    setServiceOptions(settingsData.serviceOptions || []);
  };

  const fetchBranches = async () => {
    try {
      const response = await branchAPI.getAll();
      setBranches(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error fetching branch service snapshot:', error);
      setBranches([]);
    }
  };

  const fetchHistory = async (page = 1, overrides = {}) => {
    try {
      setHistoryError('');
      const response = await settingsAPI.getHistory({
        page,
        page_size: DEFAULT_PAGE_SIZE,
        search: overrides.search ?? historySearch,
        category: (overrides.category ?? historyCategory) || undefined,
      });
      setHistoryState(response.data);
    } catch (error) {
      console.error('Error fetching configuration history:', error);
      setHistoryError(error.response?.data?.detail || 'Failed to load configuration audit history.');
    }
  };

  const fetchPageData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        fetchSettings(),
        fetchBranches(),
        fetchHistory(1, { search: historySearch, category: historyCategory }),
      ]);
      setSaveError('');
    } catch (error) {
      console.error('Error fetching system settings:', error);
      setSaveError(error.response?.data?.detail || 'Failed to load system settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPageData(); }, []);
  useEffect(() => { if (!loading) fetchHistory(1); }, [historySearch, historyCategory]);

  const handleInputChange = (event) => {
    const { name, value, type, checked } = event.target;
    setSettings((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : type === 'number' ? Number(value) : value,
    }));
  };

  const handleServiceToggle = (serviceName) => {
    if (!settings.queueEnabled) return;
    setSettings((current) => {
      const isEnabled = current.enabledServices.includes(serviceName);
      const newEnabledServices = isEnabled
        ? current.enabledServices.filter((s) => s !== serviceName)
        : [...current.enabledServices, serviceName].sort();
      return { ...current, enabledServices: newEnabledServices, queueEnabled: newEnabledServices.length > 0 };
    });
  };

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      setSaveError('');
      setSavedMessage('');
      const response = await settingsAPI.update({ ...settings, reason: reason.trim() || null });
      setSettings((previous) => ({ ...previous, ...(response.data.settings || previous) }));
      const successMessage = response.data.notice
        ? 'System configuration has been successfully saved and published.'
        : 'System configuration has been saved successfully.';
      showSystemSuccessMessage({
        title: response.data.notice ? 'Configuration Published' : 'Configuration Saved',
        message: successMessage,
      });
      setSavedMessage('');
      if (response.data.notice) window.dispatchEvent(new Event('admin-policy-updated'));
      setReason('');
      await Promise.all([fetchSettings(), fetchHistory(1)]);
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveError(error.response?.data?.detail || 'Failed to save system settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHistoryEntry = async (entry) => {
    setEntryToDelete(entry);
    setShowDeleteModal(true);
  };

  const confirmDeleteHistoryEntry = async () => {
    if (!entryToDelete) return;
    try {
      setDeletingHistoryId(entryToDelete.id);
      setHistoryError('');
      await settingsAPI.deleteHistoryEntry(entryToDelete.id);
      const nextPage = historyState.items.length === 1 && historyState.page > 1
        ? historyState.page - 1 : historyState.page;
      await fetchHistory(nextPage);
      setShowDeleteModal(false);
      setEntryToDelete(null);
    } catch (error) {
      console.error('Error deleting audit history entry:', error);
      setHistoryError(error.response?.data?.detail || 'Failed to delete the audit history entry.');
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const closeDeleteModal = () => { setShowDeleteModal(false); setEntryToDelete(null); };

  const handleSetupMfa = async () => {
    setSettingUpMfa(true);
    setMfaError('');
    try {
      const response = await settingsAPI.setupAdminMfa();
      setMfaSetupData(response.data);
    } catch (error) {
      setMfaError(error.response?.data?.detail || 'Failed to start MFA setup.');
    } finally {
      setSettingUpMfa(false);
    }
  };

  const isDirty = useMemo(() => {
    if (!savedSettings.current) return false;
    return JSON.stringify(settings) !== JSON.stringify(savedSettings.current);
  }, [settings]);

  const groupedEntries = useMemo(() => Object.entries(metadata).reduce((groups, [key, details]) => {
    const category = details.category || 'Other';
    if (!groups[category]) groups[category] = [];
    groups[category].push({ key, ...details });
    return groups;
  }, {}), [metadata]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-gray-600">Loading system settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="System Settings"
        subtitle="Manage the central configuration hub for queueing, service availability, authentication defaults, receipt requests, and operational notices."
      />

      {/* Quick-glance stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Session Timeout</p>
          <p className="mt-1 text-3xl font-bold text-primary">{settings.sessionTimeout || 30} <span className="text-lg font-medium text-gray-400">min</span></p>
          <p className="mt-1 text-sm text-gray-500">Authenticated session expiration window applied system-wide.</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Queue Status</p>
          <p className={`mt-1 text-3xl font-bold ${settings.queueEnabled ? 'text-green-600' : 'text-red-500'}`}>
            {settings.queueEnabled ? 'Open' : 'Closed'}
          </p>
          <p className="mt-1 text-sm text-gray-500">Live queue registration availability for taxpayers.</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Audit Records</p>
          <p className="mt-1 text-3xl font-bold text-primary">{historyState.total}</p>
          <p className="mt-1 text-sm text-gray-500">Configuration updates currently stored in audit history.</p>
        </div>
      </div>

      {savedMessage && (
        <div className="rounded border-l-4 border-green-500 bg-green-100 p-4 text-green-700">
          <p className="font-semibold">{savedMessage}</p>
        </div>
      )}
      {saveError && (
        <div className="rounded border-l-4 border-red-500 bg-red-100 p-4 text-red-700">
          <p className="font-semibold">{saveError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        {/* ── Left column: config groups ── */}
        <div className="space-y-6">
          {Object.entries(groupedEntries).map(([category, entries]) => (
            <div key={category} className="overflow-hidden rounded-xl bg-white shadow">
              <div className="bg-primary px-6 py-4">
                <h2 className="text-lg font-bold text-white">{category}</h2>
                <p className="mt-1 text-sm text-blue-100">
                  {sectionDescription[category] || 'Centralized system-wide configuration values.'}
                </p>
              </div>

              <div className="divide-y divide-gray-100">
                {entries.map((entry) => {
                  const queueEntry = entries.find((e) => e.key === 'queueEnabled');

                  if (entry.key === 'enabledServices') {
                    return (
                      <div key={entry.key} className="p-6 space-y-4">
                        <div>
                          <p className="font-semibold text-gray-800">{entry.label}</p>
                          <p className="mt-1 text-sm text-gray-500">{entry.description}</p>
                        </div>

                        {queueEntry && (
                          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                            <div>
                              <p className="font-semibold text-gray-700">{queueEntry.label}</p>
                              <p className={`text-xs font-medium ${settings.queueEnabled ? 'text-green-600' : 'text-gray-400'}`}>
                                {settings.queueEnabled ? 'Enabled' : 'Disabled'}
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              name="queueEnabled"
                              checked={Boolean(settings.queueEnabled)}
                              onChange={handleInputChange}
                              className="h-4 w-4 accent-green-500"
                            />
                          </label>
                        )}

                        {!settings.queueEnabled && (
                          <div className="rounded border-l-4 border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800">
                            Public services are automatically turned off while Queue System Availability is disabled.
                          </div>
                        )}

                        {/* Branch service separation table */}
                        <div className="overflow-hidden rounded-xl border border-gray-200">
                          <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
                            <p className="font-semibold text-gray-700">Branch Service Separation</p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              Read-only snapshot of each branch's queue windows.
                            </p>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  {['Branch', 'Queue Counters', 'Window Assignments', 'Verification'].map((h) => (
                                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 bg-white">
                                {branches.length ? branches.map((branch) => (
                                  <tr key={branch.id} className="hover:bg-gray-50">
                                    <td className="px-5 py-3">
                                      <p className="font-semibold text-gray-800">{branch.name}</p>
                                      <p className="text-xs text-gray-500">{branch.location || 'No location listed'}</p>
                                    </td>
                                    <td className="px-5 py-3 text-gray-700">{branch.counters || 0}</td>
                                    <td className="px-5 py-3">
                                      {getBranchWindowBadges(branch).length ? (
                                        <div className="flex flex-wrap gap-1.5">
                                          {getBranchWindowBadges(branch).map((w) => (
                                            <span
                                              key={w.windowNumber}
                                              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${w.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                                            >
                                              W{w.windowNumber}: {w.code}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <span className="text-xs text-gray-400">No windows configured</span>
                                      )}
                                    </td>
                                    <td className="px-5 py-3">
                                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                        branch.verification_status === 'Pending'
                                          ? 'bg-yellow-100 text-yellow-800'
                                          : branch.status === 'Active'
                                            ? 'bg-green-100 text-green-800'
                                            : 'bg-gray-100 text-gray-600'
                                      }`}>
                                        {branch.verification_status || branch.status || 'Unknown'}
                                      </span>
                                    </td>
                                  </tr>
                                )) : (
                                  <tr>
                                    <td colSpan="4" className="px-5 py-6 text-center text-sm text-gray-500">
                                      No branches available.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (entry.key === 'queueEnabled') return null;

                  const isBoolean = entry.type === 'boolean';
                  const isNumber = entry.type === 'integer';

                  return (
                    <div key={entry.key} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex-1">
                        <p className="font-semibold text-gray-800">{entry.label}</p>
                        <p className="mt-0.5 text-sm text-gray-500">{entry.description}</p>
                      </div>

                      {isBoolean ? (
                        <label className="flex cursor-pointer items-center gap-3">
                          <span className={`text-sm font-semibold ${settings[entry.key] ? 'text-green-600' : 'text-gray-400'}`}>
                            {settings[entry.key] ? 'Enabled' : 'Disabled'}
                          </span>
                          <input
                            type="checkbox"
                            name={entry.key}
                            checked={Boolean(settings[entry.key])}
                            onChange={handleInputChange}
                            className="h-4 w-4 accent-green-500"
                          />
                        </label>
                      ) : (
                        <input
                          type={isNumber ? 'number' : 'text'}
                          name={entry.key}
                          value={settings[entry.key]}
                          onChange={handleInputChange}
                          min={isNumber ? (entry.key === 'sessionTimeout' ? 30 : 1) : undefined}
                          className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-accent sm:w-40"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Right column: sticky sidebar ── */}
        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          {/* MFA panel */}
          <div className="overflow-hidden rounded-xl bg-white shadow">
            <div className="bg-primary px-6 py-4">
              <h2 className="text-lg font-bold text-white">Administrator Security</h2>
              <p className="mt-1 text-sm text-blue-100">Account Protection · MFA</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded border-l-4 border-yellow-400 bg-yellow-50 p-4">
                <p className="font-semibold text-yellow-900">Microsoft Authenticator</p>
                <p className="mt-1 text-sm text-yellow-800">
                  {adminUser?.mfa_setup_required
                    ? 'This account still needs MFA setup. Scan the QR code below and use Microsoft Authenticator for future logins.'
                    : 'Refresh or replace the current MFA enrollment for this administrator account.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSetupMfa}
                disabled={settingUpMfa}
                className="w-full rounded-lg bg-yellow-500 px-6 py-3 font-semibold text-white transition hover:bg-yellow-600 disabled:opacity-50"
              >
                {settingUpMfa ? 'Preparing MFA...' : 'Reset MFA'}
              </button>

              {mfaError && (
                <div className="rounded border-l-4 border-red-500 bg-red-100 p-3 text-sm text-red-700">
                  <p className="font-semibold">{mfaError}</p>
                </div>
              )}

              {mfaSetupData && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <p className="mb-3 font-semibold text-green-900">Scan this QR code in Microsoft Authenticator</p>
                  <div className="mb-4 flex justify-center">
                    <img
                      src={mfaSetupData.qr_code}
                      alt="Admin MFA QR code"
                      className="h-52 w-52 rounded-lg border-4 border-white shadow"
                    />
                  </div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-green-700">Manual entry key</p>
                  <code className="block break-all rounded border border-green-200 bg-white p-3 text-xs text-gray-700">
                    {mfaSetupData.manual_entry_key}
                  </code>
                </div>
              )}
            </div>
          </div>

          {/* Publish panel */}
          <div className="overflow-hidden rounded-xl bg-white shadow">
            <div className="bg-primary px-6 py-4">
              <h2 className="text-lg font-bold text-white">Publish Changes</h2>
              <p className="mt-1 text-sm text-blue-100">Save &amp; broadcast to branch admins</p>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500">
                Each save writes a detailed audit entry and publishes an official Policies &amp; SOPs notice for branch admins.
              </p>
              {!isDirty && (
                <p className="text-xs text-gray-400 italic">No changes detected. Modify a setting above to enable publishing.</p>
              )}
              <button
                onClick={handleSaveSettings}
                disabled={saving || !isDirty}
                className="w-full rounded-lg bg-green-600 px-5 py-3 font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? 'Applying...' : 'Save and Publish Configuration'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Audit History ── */}
      <div className="overflow-hidden rounded-xl bg-white shadow">
        <div className="bg-primary px-6 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Configuration Audit History</h2>
              <p className="mt-1 text-sm text-blue-100">Review, search, filter, and manage configuration records.</p>
            </div>
            <span className="self-start rounded-full bg-white/20 px-3 py-1 text-sm font-semibold text-white sm:self-auto">
              {historyState.total} record{historyState.total === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {/* Search / filter bar */}
        <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_auto]">
            <input
              type="text"
              value={historySearchDraft}
              onChange={(event) => setHistorySearchDraft(event.target.value)}
              placeholder="Search configuration, updated by, or reason…"
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-transparent focus:ring-2 focus:ring-accent"
            />
            <select
              value={historyCategory}
              onChange={(event) => setHistoryCategory(event.target.value)}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-transparent focus:ring-2 focus:ring-accent"
            >
              <option value="">All categories</option>
              {historyState.categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setHistorySearch(historySearchDraft.trim())}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary"
              >
                Search
              </button>
              <button
                onClick={() => { setHistorySearchDraft(''); setHistorySearch(''); setHistoryCategory(''); }}
                className="rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-300"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {historyError && (
          <div className="mx-6 mt-4 rounded border-l-4 border-red-500 bg-red-100 p-3 text-sm text-red-700">
            {historyError}
          </div>
        )}

        {historyState.items.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Setting', 'Category', 'Changed', 'Updated By', 'Actions'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {historyState.items.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-primary">{entry.setting_label}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                        <span className="rounded bg-gray-100 px-2 py-0.5 font-medium text-gray-600">{entry.previous_value_label}</span>
                        <span>→</span>
                        <span className="rounded bg-green-100 px-2 py-0.5 font-medium text-green-700">{entry.new_value_label}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">
                        {entry.category}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-gray-600">
                      {formatManilaDate(entry.changed_at)}<br />
                      <span className="text-xs text-gray-400">{formatManilaTime(entry.changed_at)}</span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-gray-700">{entry.changed_by}</td>
                    <td className="whitespace-nowrap px-5 py-4">
                      <button
                        onClick={() => handleDeleteHistoryEntry(entry)}
                        disabled={deletingHistoryId === entry.id}
                        className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600 disabled:opacity-60"
                      >
                        {deletingHistoryId === entry.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-gray-500">No configuration changes match the current filters.</div>
        )}

        {historyState.total > 0 && (
          <div className="flex flex-col gap-3 border-t border-gray-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-500">
              Showing page {historyState.page} of {historyState.total_pages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => fetchHistory(historyState.page - 1)}
                disabled={historyState.page <= 1}
                className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Previous
              </button>
              <button
                onClick={() => fetchHistory(historyState.page + 1)}
                disabled={historyState.page >= historyState.total_pages}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && entryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.29 3.86l-8.082 14A1 1 0 003.082 19h17.836a1 1 0 00.874-1.5l-8.082-14a1 1 0 00-1.74 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Delete audit record?</h3>
                <p className="mt-1 text-sm text-gray-600">
                  This will permanently remove <span className="font-semibold">{entryToDelete.setting_label}</span> from the configuration audit history.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Changed At</p>
              <p className="mt-1 text-sm font-medium text-gray-700">
                {formatManilaDate(entryToDelete.changed_at)} at {formatManilaTime(entryToDelete.changed_at)}
              </p>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={closeDeleteModal}
                disabled={deletingHistoryId !== null}
                className="rounded-lg bg-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-300 disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteHistoryEntry}
                disabled={deletingHistoryId !== null}
                className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-70"
              >
                {deletingHistoryId !== null ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
