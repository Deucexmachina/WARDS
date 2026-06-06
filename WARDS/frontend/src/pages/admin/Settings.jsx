import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { settingsAPI } from '../../services/api';
import { formatUtc8Date, formatUtc8Time } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';

const DEFAULT_PAGE_SIZE = 5;
const API_URL = 'http://localhost:8000';

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
  emailNotifications: true,
};

const sectionDescription = {
  'Queue Operations': 'Control public queue access, limits, and timing defaults used across branch workflows.',
  Services: 'Define which services stay available to the public, including online payments and receipt copy requests.',
  'Authentication & Security': 'Apply security defaults for new sessions and login lockout behavior.',
  Notifications: 'Set the default communication channels used by enabled workflows.',
  'Operational Defaults': 'Manage system-wide operational mode switches.',
};

const formatManilaDate = (value) => formatUtc8Date(value);
const formatManilaTime = (value) => formatUtc8Time(value);

const countConfiguredServices = (settings) => settings.enabledServices?.length || 0;

const showSystemSuccessMessage = ({ title, message }) => {
  window.dispatchEvent(new CustomEvent('wards:system-message', {
    detail: {
      tone: 'success',
      title,
      message,
      buttonLabel: 'OK',
    },
  }));
};

const Settings = () => {
  const [settings, setSettings] = useState(defaultSettings);
  const [serviceOptions, setServiceOptions] = useState([]);
  const [metadata, setMetadata] = useState({});
  const [historyState, setHistoryState] = useState({
    items: [],
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
    total: 0,
    total_pages: 1,
    categories: [],
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
  const [settingsAuthenticated, setSettingsAuthenticated] = useState(false);
  const [authStep, setAuthStep] = useState('credentials');
  const [authForm, setAuthForm] = useState({ email: '', password: '', totpCode: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
  const adminRoleLabel = adminUser?.internal_role === 'superadmin'
    ? 'Superadmin'
    : adminUser?.internal_role === 'branch_admin'
      ? 'Branch Admin'
      : 'Main Admin';
  const adminDashboardLabel = adminUser?.internal_role === 'superadmin'
    ? 'superadmin'
    : adminUser?.internal_role === 'branch_admin'
      ? 'branch admin'
      : 'main admin';

  const fetchSettings = async () => {
    const settingsResponse = await settingsAPI.get();
    const settingsData = settingsResponse.data || {};
    setSettings({
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
      emailNotifications: Boolean(settingsData.emailNotifications),
    });
    setMetadata(settingsData.metadata || {});
    setServiceOptions(settingsData.serviceOptions || []);
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

  useEffect(() => {
    if (settingsAuthenticated) {
      fetchPageData();
    } else {
      setLoading(false);
    }
  }, [settingsAuthenticated]);

  useEffect(() => {
    if (!loading) {
      fetchHistory(1);
    }
  }, [historySearch, historyCategory]);

  const handleInputChange = (event) => {
    const { name, value, type, checked } = event.target;
    setSettings((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : type === 'number' ? Number(value) : value,
    }));
  };

  const handleServiceToggle = (serviceName) => {
    if (!settings.queueEnabled) {
      return;
    }

    setSettings((current) => {
      const isEnabled = current.enabledServices.includes(serviceName);
      return {
        ...current,
        enabledServices: isEnabled
          ? current.enabledServices.filter((service) => service !== serviceName)
          : [...current.enabledServices, serviceName].sort(),
      };
    });
  };

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      setSaveError('');
      setSavedMessage('');

      const response = await settingsAPI.update({
        ...settings,
        reason: reason.trim() || null,
      });

      setSettings((previous) => ({ ...previous, ...(response.data.settings || previous) }));
      const successMessage = response.data.notice
        ? 'System configuration has been successfully saved and published.'
        : 'System configuration has been saved successfully.';

      showSystemSuccessMessage({
        title: response.data.notice ? 'Configuration Published' : 'Configuration Saved',
        message: successMessage,
      });

      setSavedMessage('');
      if (response.data.notice) {
        window.dispatchEvent(new Event('admin-policy-updated'));
      }
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
    if (!entryToDelete) {
      return;
    }

    try {
      setDeletingHistoryId(entryToDelete.id);
      setHistoryError('');
      await settingsAPI.deleteHistoryEntry(entryToDelete.id);
      const nextPage = historyState.items.length === 1 && historyState.page > 1
        ? historyState.page - 1
        : historyState.page;
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

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setEntryToDelete(null);
  };

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

  const groupedEntries = useMemo(() => Object.entries(metadata).reduce((groups, [key, details]) => {
    const category = details.category || 'Other';
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push({ key, ...details });
    return groups;
  }, {}), [metadata]);

  const handleSettingsLogin = async (event) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const normalizedEmail = authForm.email.trim().toLowerCase();
      const currentEmail = String(adminUser?.email || '').toLowerCase();
      if (normalizedEmail && currentEmail && normalizedEmail !== currentEmail) {
        setAuthError('Use the same admin account that is already signed in to the main dashboard.');
        return;
      }
      const response = await axios.post(`${API_URL}/api/auth/unified/login`, {
        identifier: authForm.email,
        password: authForm.password,
        portal: 'admin',
        totp_code: authStep === 'totp' ? authForm.totpCode : undefined,
      });
      if (response.data.requires_mfa) {
        setAuthStep('totp');
        return;
      }
      if (response.data.portal !== 'admin') {
        setAuthError('Only admin accounts can access System Settings.');
        return;
      }
      if (adminUser?.id && response.data.user?.id && Number(adminUser.id) !== Number(response.data.user.id)) {
        setAuthError('System Settings re-authentication must use the same admin account that opened the dashboard.');
        return;
      }
      localStorage.setItem('adminToken', response.data.access_token);
      localStorage.setItem('adminUser', JSON.stringify(response.data.user));
      setSettingsAuthenticated(true);
    } catch (error) {
      const detail = error.response?.data?.detail || 'System Settings login failed.';
      setAuthError(String(detail).toLowerCase().includes('mfa not configured')
        ? 'MFA is required. Set up Microsoft Authenticator in the main WARDS login first.'
        : detail);
    } finally {
      setAuthLoading(false);
    }
  };

  if (!settingsAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-900 via-blue-800 to-slate-900 p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
          <div className="mb-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{adminRoleLabel}</p>
            <h1 className="mt-2 text-3xl font-bold text-gray-900">System Settings</h1>
            <p className="mt-2 text-gray-600">
              {authStep === 'totp' ? 'MFA required for secured settings access' : `${adminRoleLabel} secured access`}
            </p>
          </div>
          {authError && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{authError}</div>}
          {authStep === 'credentials' && (
            <form onSubmit={handleSettingsLogin} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Email Address</label>
                  <input value={authForm.email} onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))} className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-500" placeholder="admin@example.com" autoComplete="email" required />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Password</label>
                  <input type="password" value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-500" autoComplete="current-password" required />
                </div>
                <button type="submit" disabled={authLoading} className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">{authLoading ? 'Checking account...' : 'Continue'}</button>
            </form>
          )}
          {authStep === 'totp' && (
            <form onSubmit={handleSettingsLogin} className="space-y-5">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Enter the 6-digit code from your authenticator app.</p>
                  <p className="mt-2 text-xs text-gray-500">
                    Use the current code from Microsoft Authenticator. If the code fails, check that your device time is set automatically and try again.
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Authenticator Code</label>
                  <input type="text" value={authForm.totpCode} onChange={(event) => setAuthForm((current) => ({ ...current, totpCode: event.target.value.replace(/\D/g, '').slice(0, 6) }))} className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-500" placeholder="000000" maxLength="6" autoComplete="one-time-code" required />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setAuthStep('credentials'); setAuthForm((current) => ({ ...current, totpCode: '' })); setAuthError(''); }} className="flex-1 rounded-xl bg-gray-200 py-3 font-semibold text-gray-800 transition hover:bg-gray-300">Back</button>
                  <button type="submit" disabled={authLoading || authForm.totpCode.length !== 6} className="flex-1 rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">{authLoading ? 'Signing in...' : 'Login'}</button>
                </div>
            </form>
          )}
          <div className="mt-8 text-center">
            <Link to="/admin" className="text-sm font-semibold text-slate-600 hover:text-primary">
              Return to {adminDashboardLabel} dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
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

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Enabled Public Services</p>
          <p className="mt-2 text-3xl font-bold text-primary">{countConfiguredServices(settings)}</p>
          <p className="mt-2 text-sm text-slate-500">Active services currently visible in public-facing workflows.</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Queue Status</p>
          <p className="mt-2 text-3xl font-bold text-primary">{settings.queueEnabled ? 'Open' : 'Closed'}</p>
          <p className="mt-2 text-sm text-slate-500">Live queue registration availability for taxpayers.</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow">
          <p className="text-sm font-medium text-slate-500">Audit Records</p>
          <p className="mt-2 text-3xl font-bold text-primary">{historyState.total}</p>
          <p className="mt-2 text-sm text-slate-500">Configuration updates currently stored in audit history.</p>
        </div>
      </section>

      {savedMessage && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-green-800 shadow-sm">
          <p className="font-semibold">{savedMessage}</p>
        </div>
      )}

      {saveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700 shadow-sm">
          <p className="font-semibold">{saveError}</p>
        </div>
      )}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_0.55fr]">
        <div className="space-y-6">
          {Object.entries(groupedEntries).map(([category, entries]) => (
            <div key={category} className="overflow-hidden rounded-2xl bg-white shadow">
              <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Configuration Group</p>
                <h2 className="mt-2 text-xl font-bold text-primary">{category}</h2>
                <p className="mt-2 text-sm text-gray-500">
                  {sectionDescription[category] || 'Centralized system-wide configuration values.'}
                </p>
              </div>

              <div className="space-y-4 p-6">
                {entries.map((entry) => {
                  if (entry.key === 'enabledServices') {
                    return (
                      <div key={entry.key} className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                        <div className="mb-4 flex flex-col gap-2 border-b border-slate-200 pb-4">
                          <p className="font-semibold text-slate-800">{entry.label}</p>
                          <p className="mt-1 text-sm text-slate-500">{entry.description}</p>
                          {!settings.queueEnabled && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                              Public services are automatically turned off while Queue System Availability is disabled.
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {serviceOptions.map((serviceName) => {
                            const isChecked = settings.queueEnabled && settings.enabledServices.includes(serviceName);
                            return (
                              <label
                                key={serviceName}
                                className={`flex items-center justify-between rounded-xl border px-4 py-3 transition ${
                                  isChecked
                                    ? 'border-emerald-200 bg-emerald-50'
                                    : settings.queueEnabled
                                      ? 'cursor-pointer border-slate-200 bg-white hover:border-slate-300'
                                      : 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-75'
                                }`}
                              >
                                <span className="text-sm font-medium text-slate-700">{serviceName}</span>
                                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${isChecked ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                  {isChecked ? 'On' : 'Off'}
                                </span>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleServiceToggle(serviceName)}
                                  disabled={!settings.queueEnabled}
                                  className="sr-only"
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  const isBoolean = entry.type === 'boolean';
                  const isNumber = entry.type === 'integer';

                  return (
                    <div key={entry.key} className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex-1">
                          <p className="font-semibold text-slate-800">{entry.label}</p>
                          <p className="mt-1 text-sm text-slate-500">{entry.description}</p>
                        </div>

                        {isBoolean ? (
                          <label className={`inline-flex min-w-[132px] cursor-pointer items-center justify-between rounded-full border px-4 py-3 text-sm font-semibold transition ${settings[entry.key] ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600'}`}>
                            <span>{settings[entry.key] ? 'Enabled' : 'Disabled'}</span>
                            <input
                              type="checkbox"
                              name={entry.key}
                              checked={Boolean(settings[entry.key])}
                              onChange={handleInputChange}
                              className="h-5 w-5 accent-emerald-500"
                            />
                          </label>
                        ) : (
                          <div className="w-full rounded-2xl border border-slate-200 bg-white p-2 lg:max-w-xs">
                            <input
                              type={isNumber ? 'number' : 'text'}
                              name={entry.key}
                              value={settings[entry.key]}
                              onChange={handleInputChange}
                              min={isNumber ? 1 : undefined}
                              className="w-full rounded-xl border-0 bg-transparent px-3 py-2 text-sm text-gray-700 outline-none focus:ring-0"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-2xl bg-white p-6 shadow">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Ready To Apply</p>
            <h2 className="mt-2 text-xl font-bold text-primary">Publish Changes</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Each save writes a detailed audit entry and publishes an official Policies & SOPs notice for branch admins.
            </p>
            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Reason for change</label>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows="4"
                placeholder="Optional explanation for the configuration update"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-blue-100"
              ></textarea>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mt-5 w-full rounded-2xl bg-primary px-5 py-4 font-semibold text-white transition duration-300 hover:bg-secondary disabled:opacity-60"
            >
              {saving ? 'Applying System Configuration...' : 'Save and Publish System Configuration'}
            </button>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Account Protection</p>
            <h2 className="mt-2 text-xl font-bold text-primary">Administrator Security</h2>
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="font-semibold text-amber-900">Microsoft Authenticator</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  {adminUser?.mfa_setup_required
                    ? 'This account still needs MFA setup. Scan the QR code below and use Microsoft Authenticator for future logins.'
                    : 'Refresh or replace the current MFA enrollment for this administrator account.'}
                </p>
              </div>

              <button
                type="button"
                onClick={handleSetupMfa}
                disabled={settingUpMfa}
                className="w-full rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {settingUpMfa ? 'Preparing MFA...' : 'Reset MFA'}
              </button>

              {mfaError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                  <p className="font-semibold">{mfaError}</p>
                </div>
              )}

              {mfaSetupData && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                  <p className="mb-3 font-semibold text-emerald-900">Scan this QR code in Microsoft Authenticator</p>
                  <div className="mb-4 flex justify-center">
                    <img
                      src={mfaSetupData.qr_code}
                      alt="Admin MFA QR code"
                      className="h-56 w-56 rounded-xl border-4 border-white shadow-lg"
                    />
                  </div>
                  <p className="mb-2 text-sm text-emerald-900">Manual entry key</p>
                  <code className="block break-all rounded-lg border border-emerald-200 bg-white p-3 text-sm">
                    {mfaSetupData.manual_entry_key}
                  </code>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow">
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Traceability</p>
              <h2 className="mt-2 text-2xl font-bold text-primary">Configuration Audit History</h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                Review, search, filter, and manage configuration records in one organized timeline.
              </p>
            </div>
            <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
              {historyState.total} record{historyState.total === 1 ? '' : 's'}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_220px_220px]">
            <input
              type="text"
              value={historySearchDraft}
              onChange={(event) => setHistorySearchDraft(event.target.value)}
              placeholder="Search configuration, updated by, or reason"
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
            <select
              value={historyCategory}
              onChange={(event) => setHistoryCategory(event.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-blue-100"
            >
              <option value="">All categories</option>
              {historyState.categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <div className="flex gap-3">
              <button
                onClick={() => setHistorySearch(historySearchDraft.trim())}
                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary"
              >
                Search
              </button>
              <button
                onClick={() => {
                  setHistorySearchDraft('');
                  setHistorySearch('');
                  setHistoryCategory('');
                }}
                className="flex-1 rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {historyError && (
          <div className="mx-6 mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {historyError}
          </div>
        )}

        <div className="space-y-4 p-6">
          {historyState.items.length ? historyState.items.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:border-slate-300">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {entry.category}
                    </span>
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                      {formatManilaDate(entry.changed_at)} at {formatManilaTime(entry.changed_at)}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-primary">{entry.setting_label}</h3>
                  <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Previous</p>
                      <p className="mt-2 text-sm font-medium text-slate-700">{entry.previous_value_label}</p>
                    </div>
                    <div className="justify-self-center text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
                      to
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">New</p>
                      <p className="mt-2 text-sm font-medium text-emerald-900">{entry.new_value_label}</p>
                    </div>
                  </div>
                </div>

                <div className="flex w-full flex-col gap-3 lg:w-[240px]">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Updated By</p>
                    <p className="mt-2 text-sm font-medium text-slate-700">{entry.changed_by}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Reason</p>
                    <p className="mt-2 text-sm font-medium text-slate-700">{entry.reason || 'No reason provided.'}</p>
                  </div>
                  <button
                    onClick={() => handleDeleteHistoryEntry(entry)}
                    disabled={deletingHistoryId === entry.id}
                    className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingHistoryId === entry.id ? 'Deleting...' : 'Delete Record'}
                  </button>
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center text-sm text-slate-500">
              No configuration changes match the current filters.
            </div>
          )}
        </div>

        {historyState.total > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              Showing page {historyState.page} of {historyState.total_pages}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => fetchHistory(historyState.page - 1)}
                disabled={historyState.page <= 1}
                className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Previous
              </button>
              <button
                onClick={() => fetchHistory(historyState.page + 1)}
                disabled={historyState.page >= historyState.total_pages}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {showDeleteModal && entryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl md:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M10.29 3.86l-8.082 14A1 1 0 003.082 19h17.836a1 1 0 00.874-1.5l-8.082-14a1 1 0 00-1.74 0z"></path>
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-400">Confirm Deletion</p>
                <h3 className="mt-2 text-2xl font-bold text-primary">Delete this audit history entry?</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  This will permanently remove <span className="font-semibold text-slate-800">{entryToDelete.setting_label}</span> from the configuration audit history.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Changed At</p>
              <p className="mt-2 text-sm font-medium text-slate-700">
                {formatManilaDate(entryToDelete.changed_at)} at {formatManilaTime(entryToDelete.changed_at)}
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 md:flex-row md:justify-end">
              <button
                onClick={closeDeleteModal}
                disabled={deletingHistoryId !== null}
                className="rounded-2xl bg-slate-200 px-5 py-3 font-semibold text-slate-700 transition duration-300 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteHistoryEntry}
                disabled={deletingHistoryId !== null}
                className="rounded-2xl bg-red-600 px-5 py-3 font-semibold text-white transition duration-300 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {deletingHistoryId !== null ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
