import { useEffect, useState } from 'react';
import { accountAPI, branchAPI } from '../../services/api';
import { getEmailValidationMessage, validateStrongPassword } from '../../utils/validation';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import PasswordField from '../../components/PasswordField';

const DEFAULT_PAGE_SIZE = 100;

const EMPTY_FORM = {
  username: '',
  email: '',
  password: '',
  full_name: '',
  role: 'branch_staff',
  branch_id: null,
  service_window: '',
  assigned_window_number: 1,
  status: 'Active',
};

const BRANCH_ACCOUNT_ROLE_ORDER = {
  branch_admin: 0,
  branch_staff: 1,
};

const SERVICE_WINDOW_OPTIONS = [
  { value: 'RPT', label: 'RPT' },
  { value: 'BUSINESS', label: 'BT' },
  { value: 'MISC', label: 'MISC' },
  { value: 'QW4', label: 'Queue Window 4' },
  { value: 'QW5', label: 'Queue Window 5' },
];

const PHYSICAL_WINDOW_OPTIONS = [1, 2, 3, 4, 5];

const INTERNAL_BRANCH_EMAIL_PATTERN = /^[A-Za-z0-9._-]+@branch\.local$/i;

const Accounts = () => {
  const adminUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('adminUser') || '{}');
    } catch {
      return {};
    }
  })();
  const verifierLabel = adminUser?.internal_role === 'superadmin' ? 'Super Admin' : 'Main Admin';
  const verifierLabelLower = verifierLabel.toLowerCase();
  const [accounts, setAccounts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [authModal, setAuthModal] = useState({
    mode: null,
    account: null,
    password: '',
  });
  const [pendingAccountSave, setPendingAccountSave] = useState(null);
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
    total: 0,
    total_pages: 1,
  });
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [emailError, setEmailError] = useState('');

  const getServiceWindowLabel = (value) => {
    if (value === 'BUSINESS') return 'BT';
    return value || 'Not Assigned';
  };

  const getAccountEmailValidationMessage = (email, role) => {
    const trimmedEmail = String(email || '').trim();
    if (role === 'branch_staff' && INTERNAL_BRANCH_EMAIL_PATTERN.test(trimmedEmail)) {
      return '';
    }
    return getEmailValidationMessage(trimmedEmail);
  };

  useEffect(() => {
    fetchAccounts(1);
    fetchBranches();

    const handleAccountsRefresh = () => {
      fetchAccounts(pagination.page);
      fetchBranches();
    };

    window.addEventListener('wards-accounts-refresh', handleAccountsRefresh);
    return () => window.removeEventListener('wards-accounts-refresh', handleAccountsRefresh);
  }, [pagination.page]);

  const fetchAccounts = async (page = pagination.page) => {
    try {
      const response = await accountAPI.getAll({
        page,
        page_size: pagination.page_size,
      });
      setAccounts(response.data.items || []);
      setPagination((current) => ({
        ...current,
        page: response.data.page || page,
        page_size: response.data.page_size || current.page_size,
        total: response.data.total || 0,
        total_pages: response.data.total_pages || 1,
      }));
      setError('');
      setLoading(false);
    } catch (fetchError) {
      console.error('Failed to fetch accounts:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load accounts.');
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const response = await branchAPI.getAll();
      setBranches(response.data);
    } catch (fetchError) {
      console.error('Failed to fetch branches:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load branches.');
    }
  };

  const updateAccountInState = (updatedAccount) => {
    if (!updatedAccount?.id || !updatedAccount?.role) {
      return;
    }

    setAccounts((current) => current.map((account) => (
      account.id === updatedAccount.id && account.role === updatedAccount.role
        ? { ...account, ...updatedAccount }
        : account
    )));
  };

  const handlePageChange = (nextPage) => {
    if (nextPage < 1 || nextPage > pagination.total_pages || nextPage === pagination.page) {
      return;
    }
    setLoading(true);
    fetchAccounts(nextPage);
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    if (name === 'role') {
      const nextState = { ...formData, role: value };
      if (value !== 'branch_staff') {
        nextState.service_window = '';
        nextState.assigned_window_number = 1;
      }
      setFormData(nextState);
      setEmailError(getAccountEmailValidationMessage(nextState.email, value));
      if (error) {
        setError('');
      }
      return;
    }
    const nextState = { ...formData, [name]: value };
    setFormData(nextState);
    if (name === 'email') {
      setEmailError(getAccountEmailValidationMessage(value, formData.role));
    }
    if (error) {
      setError('');
    }
  };

  const handleAddAccount = () => {
    setEditingAccount(null);
    setFormData(EMPTY_FORM);
    setEmailError('');
    setError('');
    setSuccessMessage('');
    setShowModal(true);
  };

  const handleEditAccount = (account) => {
    setEditingAccount(account);
    setFormData({
      username: account.username || '',
      email: account.email,
      password: '',
      full_name: account.full_name || '',
      role: account.role,
      branch_id: account.branch_id,
      service_window: account.service_window || '',
      assigned_window_number: account.assigned_window_number || 1,
      status: account.status,
    });
    setError('');
    setEmailError('');
    setSuccessMessage('');
    setShowModal(true);
  };

  const handleSaveAccount = async () => {
    const needsUsername = ['main_admin', 'admin', 'branch_admin', 'branch_staff'].includes(formData.role);
    const needsFullName = formData.role === 'public';

    if (!formData.email || !formData.role || (needsUsername && !formData.username) || (needsFullName && !formData.full_name)) {
      setError('Please fill in all required fields.');
      return;
    }

    const nextEmailError = getAccountEmailValidationMessage(formData.email, formData.role);
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setError('Please correct the highlighted email field.');
      return;
    }

    if (!editingAccount && !formData.password) {
      setError('Password is required for new accounts.');
      return;
    }

    if (formData.password) {
      const passwordError = validateStrongPassword(formData.password);
      if (passwordError) {
        setError(passwordError);
        return;
      }
    }

    if ((formData.role === 'branch_admin' || formData.role === 'branch_staff') && !formData.branch_id) {
      setError('Please assign a branch for branch accounts.');
      return;
    }

    if (formData.role === 'branch_staff' && !formData.service_window) {
      setError('Please select the assigned queue/service role for this branch staff account.');
      return;
    }

    if (formData.role === 'branch_staff') {
      const assignedWindowNumber = Number.parseInt(formData.assigned_window_number, 10);
      if (Number.isNaN(assignedWindowNumber) || assignedWindowNumber < 1 || assignedWindowNumber > 5) {
        setError('Please assign a physical window from 1 to 5 for this branch staff account.');
        return;
      }
    }

    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      if (editingAccount) {
        setPendingAccountSave({
          id: editingAccount.id,
          payload: {
            ...formData,
          },
        });
        setAuthModal({
          mode: 'edit',
          account: editingAccount,
          password: '',
        });
        setLoading(false);
        return;
      }

      await accountAPI.create(formData);
      window.dispatchEvent(new Event('wards-accounts-refresh'));
      await fetchAccounts(1);
      setShowModal(false);
      setFormData(EMPTY_FORM);
      setSuccessMessage('Account created successfully.');
    } catch (saveError) {
      console.error('Failed to save account:', saveError);
      setError(saveError.response?.data?.detail || 'Failed to save account.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivateAccount = async (account) => {
    setError('');
    setSuccessMessage('');
    setAuthModal({
      mode: 'deactivate',
      account,
      password: '',
    });
  };

  const handleDeleteAccount = async (account) => {
    setError('');
    setSuccessMessage('');
    setAuthModal({
      mode: 'delete',
      account,
      password: '',
    });
  };

  const closeAuthModal = () => {
    setError('');
    setAuthModal({ mode: null, account: null, password: '' });
    setPendingAccountSave(null);
  };

  const handleConfirmProtectedAction = async () => {
    if (!authModal.password) {
      setError(`Please enter your ${verifierLabelLower} password to continue.`);
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccessMessage('');

      if (authModal.mode === 'edit' && pendingAccountSave) {
        const response = await accountAPI.update(pendingAccountSave.id, {
          ...pendingAccountSave.payload,
          current_admin_password: authModal.password,
        });
        updateAccountInState(response.data);
        await fetchAccounts(pagination.page);
        setShowModal(false);
        setFormData(EMPTY_FORM);
        setSuccessMessage('Account updated successfully.');
        window.dispatchEvent(new Event('wards-accounts-refresh'));
      }

      if (authModal.mode === 'deactivate' && authModal.account) {
        await accountAPI.deactivate(authModal.account.id, authModal.account.role, {
          current_admin_password: authModal.password,
        });
        await fetchAccounts(pagination.page);
        setSuccessMessage('Account deactivated successfully.');
        window.dispatchEvent(new Event('wards-accounts-refresh'));
      }

      if (authModal.mode === 'delete' && authModal.account) {
        await accountAPI.delete(authModal.account.id, authModal.account.role, {
          current_admin_password: authModal.password,
        });
        const nextPage = accounts.length === 1 && pagination.page > 1 ? pagination.page - 1 : pagination.page;
        await fetchAccounts(nextPage);
        setSuccessMessage('Account deleted successfully.');
        window.dispatchEvent(new Event('wards-accounts-refresh'));
      }

      closeAuthModal();
    } catch (actionError) {
      console.error('Failed to complete protected account action:', actionError);
      setError(actionError.response?.data?.detail || 'Failed to complete account action.');
    } finally {
      setLoading(false);
    }
  };

  const getRoleDisplay = (role) => {
    const roleMap = {
      main_admin: 'Main Admin',
      superadmin: 'Super Admin',
      branch_admin: 'Branch Admin',
      branch_staff: 'Branch Staff',
      admin: 'Admin',
      public: 'Citizen',
    };
    return roleMap[role] || role;
  };

  const getRoleColor = (role) => {
    if (role === 'main_admin' || role === 'admin' || role === 'superadmin') return 'bg-purple-100 text-purple-800';
    if (role === 'branch_admin') return 'bg-blue-100 text-blue-800';
    if (role === 'branch_staff') return 'bg-sky-100 text-sky-800';
    if (role === 'public') return 'bg-emerald-100 text-emerald-800';
    return 'bg-gray-100 text-gray-800';
  };

  const adminAccounts = accounts.filter((account) => account.role === 'main_admin' || account.role === 'admin' || account.role === 'superadmin');
  const branchAccounts = accounts.filter((account) => account.role === 'branch_admin' || account.role === 'branch_staff');
  const citizenAccounts = accounts.filter((account) => account.role === 'public');

  const groupedBranchAccounts = branchAccounts.reduce((groups, account) => {
    const branchName = account.branch_name || 'Unassigned Branch';
    if (!groups[branchName]) {
      groups[branchName] = [];
    }
    groups[branchName].push(account);
    return groups;
  }, {});

  const sortedBranchGroups = Object.entries(groupedBranchAccounts)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([branchName, rows]) => [
      branchName,
      [...rows].sort((left, right) => {
        const leftRank = BRANCH_ACCOUNT_ROLE_ORDER[left.role] ?? 99;
        const rightRank = BRANCH_ACCOUNT_ROLE_ORDER[right.role] ?? 99;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return (left.username || left.full_name || '').localeCompare(right.username || right.full_name || '');
      }),
    ]);

  const renderAccountRows = (rows, primaryLabel = 'Username') => (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{primaryLabel}</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Branch</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Role</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Queue Role</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Last Login</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.length === 0 ? (
            <tr>
              <td colSpan="8" className="px-6 py-6 text-sm text-center text-gray-500">No accounts found.</td>
            </tr>
          ) : (
            rows.map((account) => (
              <tr key={`${account.role}-${account.id}`} className="hover:bg-gray-50 transition duration-200">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {account.username || account.full_name || 'N/A'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{account.email}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{account.branch_name || 'All Branches'}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getRoleColor(account.role)}`}>
                    {getRoleDisplay(account.role)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {account.role === 'branch_staff'
                    ? `${getServiceWindowLabel(account.service_window_label || account.service_window)} - Window ${account.assigned_window_number || 1}`
                    : account.role === 'branch_admin'
                    ? 'Full Branch'
                    : 'N/A'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    account.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {account.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {account.last_login ? formatUtc8DateTime(account.last_login) : 'Never'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                  <button
                    onClick={() => handleEditAccount(account)}
                    className="bg-accent hover:bg-blue-600 text-white px-3 py-1 rounded-lg font-semibold transition duration-300"
                  >
                    Edit
                  </button>
                  {account.status === 'Active' && (
                    <button
                      onClick={() => handleDeactivateAccount(account)}
                      className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded-lg font-semibold transition duration-300"
                    >
                      Deactivate
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteAccount(account)}
                    className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg font-semibold transition duration-300"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderAccountTable = (title, rows, primaryLabel = 'Username') => (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-6">
      <div className="px-6 py-4 bg-primary">
        <h3 className="text-xl font-bold text-white">{title}</h3>
      </div>
      {renderAccountRows(rows, primaryLabel)}
    </div>
  );

  const renderBranchAccountTable = () => (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-6">
      <div className="px-6 py-4 bg-primary">
        <h3 className="text-xl font-bold text-white">Branch Accounts</h3>
        <p className="mt-1 text-sm text-blue-100">
          Accounts are grouped by branch so branch admins and branch staff stay together as branches grow.
        </p>
      </div>

      {sortedBranchGroups.length === 0 ? (
        <div className="px-6 py-6 text-sm text-center text-gray-500">No branch accounts found.</div>
      ) : (
        <div className="space-y-5 p-5">
          {sortedBranchGroups.map(([branchName, rows]) => {
            const branchAdminCount = rows.filter((account) => account.role === 'branch_admin').length;
            const branchStaffCount = rows.filter((account) => account.role === 'branch_staff').length;

            return (
              <section key={branchName} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-6 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h4 className="text-lg font-bold text-primary">{branchName}</h4>
                    <p className="mt-1 text-sm text-slate-500">
                      {rows.length} branch account{rows.length === 1 ? '' : 's'} in this branch
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">
                      {branchAdminCount} Branch Admin{branchAdminCount === 1 ? '' : 's'}
                    </span>
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-800">
                      {branchStaffCount} Branch Staff
                    </span>
                  </div>
                </div>
                {renderAccountRows(rows)}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="border-4 border-primary border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading accounts...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="Account Management"
        subtitle="Create, review, and maintain main admin, branch, and citizen accounts."
        actions={(
          <button
            onClick={handleAddAccount}
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-semibold transition duration-300 shadow-lg"
          >
            + Create Account
          </button>
        )}
      />

      {error && (
        <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
          <p className="font-semibold">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="mb-6 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded">
          <p className="font-semibold">{successMessage}</p>
        </div>
      )}

      {renderAccountTable('Main Admin Accounts', adminAccounts)}
      {renderBranchAccountTable()}
      {renderAccountTable('Citizen Accounts', citizenAccounts, 'Full Name')}

      <div className="flex flex-col gap-3 border-t border-gray-100 px-2 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          Showing page {pagination.page} of {pagination.total_pages} · {pagination.total} total account{pagination.total === 1 ? '' : 's'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => handlePageChange(pagination.page - 1)}
            disabled={pagination.page <= 1 || loading}
            className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Previous
          </button>
          <button
            onClick={() => handlePageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.total_pages || loading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            Next
          </button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl">
            {/* Sticky Header */}
            <div className="flex-shrink-0 border-b border-slate-200 bg-white px-6 py-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">
                    {editingAccount ? 'Edit Account' : 'Create Account'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {editingAccount 
                      ? 'Update account information and permissions'
                      : 'Create a new user account with appropriate access level'
                    }
                  </p>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                  aria-label="Close modal"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
              {error && (
                <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <div>
                      <p className="font-semibold text-red-800">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-6">
                {/* Account Information Section */}
                <div>
                  <h4 className="text-lg font-semibold text-slate-900 mb-4">Account Information</h4>
                  <div className="space-y-4">
                    {formData.role === 'public' ? (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Full Name</label>
                        <input
                          type="text"
                          name="full_name"
                          value={formData.full_name}
                          onChange={handleInputChange}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                          placeholder="Enter full name"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Username</label>
                        <input
                          type="text"
                          name="username"
                          value={formData.username}
                          onChange={handleInputChange}
                          maxLength={32}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                          placeholder="Enter username"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Email Address</label>
                      <input
                        type="text"
                        inputMode="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        className={`w-full rounded-xl border px-4 py-3 text-sm font-medium placeholder-slate-400 shadow-sm transition-colors focus:ring-2 focus:outline-none ${
                          emailError 
                            ? 'border-red-300 bg-red-50 text-red-900 placeholder-red-300 focus:border-red-500 focus:ring-red-500/20' 
                            : 'border-slate-300 text-slate-900 focus:border-blue-500 focus:ring-blue-500/20'
                        }`}
                        placeholder="Enter email address"
                      />
                      {emailError && (
                        <p className="mt-2 flex items-center gap-1 text-sm font-medium text-red-600">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                          </svg>
                          {emailError}
                        </p>
                      )}
                    </div>

                    {formData.role !== 'public' && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Full Name</label>
                        <input
                          type="text"
                          name="full_name"
                          value={formData.full_name}
                          onChange={handleInputChange}
                          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                          placeholder="Enter full name (optional)"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Security Section */}
                <div>
                  <h4 className="text-lg font-semibold text-slate-900 mb-4">Security</h4>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        {editingAccount ? 'New Password (leave blank to keep current)' : 'Password'}
                      </label>
                      <PasswordField
                        name="password"
                        value={formData.password}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                        placeholder={editingAccount ? "Enter new password" : "Enter password"}
                      />
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-slate-500">
                          Password must be more than 12 characters with uppercase, lowercase, and a number or special character.
                        </p>
                        {editingAccount && (
                          <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
                            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                            <p className="text-xs font-medium text-amber-800">
                              Saving changes will require your {verifierLabelLower} password for verification.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Access Control Section */}
                <div>
                  <h4 className="text-lg font-semibold text-slate-900 mb-4">Access Control</h4>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Role</label>
                      <select
                        name="role"
                        value={formData.role}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                        required
                      >
                        <option value="main_admin">Main Office Admin</option>
                        <option value="branch_admin">Branch Admin</option>
                        <option value="branch_staff">Branch Staff</option>
                        <option value="public">Citizen</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Status</label>
                      <select
                        name="status"
                        value={formData.status}
                        onChange={handleInputChange}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </div>
                  </div>

                  {(formData.role === 'branch_admin' || formData.role === 'branch_staff') && (
                    <div className="mt-4 space-y-4">
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Branch Assignment</label>
                      <select
                        name="branch_id"
                        value={formData.branch_id || ''}
                        onChange={(event) => setFormData({ ...formData, branch_id: event.target.value ? parseInt(event.target.value, 10) : null })}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                        required
                      >
                        <option value="">Select Branch</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                      </select>

                      {formData.role === 'branch_staff' && (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Assigned Queue / Service Role</label>
                            <select
                              name="service_window"
                              value={formData.service_window}
                              onChange={handleInputChange}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                              required
                            >
                              <option value="">Select Queue / Service Role</option>
                              {SERVICE_WINDOW_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <p className="mt-2 text-xs text-slate-500">
                              Branch staff accounts must be assigned to exactly one queue/service role.
                            </p>
                          </div>

                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Voice Announcement Window</label>
                            <select
                              name="assigned_window_number"
                              value={formData.assigned_window_number || 1}
                              onChange={(event) => setFormData({ ...formData, assigned_window_number: Number.parseInt(event.target.value, 10) })}
                              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                              required
                            >
                              {PHYSICAL_WINDOW_OPTIONS.map((windowNumber) => (
                                <option key={windowNumber} value={windowNumber}>
                                  Window {windowNumber}
                                </option>
                              ))}
                            </select>
                            <p className="mt-2 text-xs text-slate-500">
                              Voice announcements use this physical window number.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sticky Footer */}
            <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setShowModal(false)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500/20 sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAccount}
                  disabled={loading}
                  className="w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600 sm:w-auto"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                      </svg>
                      Saving...
                    </span>
                  ) : (
                    editingAccount ? 'Update Account' : 'Create Account'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {authModal.mode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md flex flex-col rounded-2xl bg-white shadow-2xl max-h-[90vh]">
            {/* Header */}
            <div className="flex-shrink-0 border-b border-slate-200 bg-white px-6 py-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    {authModal.mode === 'edit' ? 'Verify Account Update' : 
                     authModal.mode === 'deactivate' ? 'Verify Account Deactivation' : 
                     'Verify Account Deletion'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Review the change, then confirm your identity to proceed
                  </p>
                </div>
                <button
                  onClick={closeAuthModal}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                  aria-label="Close modal"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
              <div className="mb-6">
                <p className="text-sm text-slate-600">
                  Enter your {verifierLabelLower} password to {authModal.mode} the account
                  {authModal.account?.username
                    ? ` "${authModal.account.username}"`
                    : authModal.account?.full_name
                    ? ` "${authModal.account.full_name}"`
                    : ''}
                  .
                </p>
              </div>

              {authModal.mode === 'edit' && pendingAccountSave && (
                <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <p className="text-sm font-semibold text-blue-900">Update Summary</p>
                  <div className="mt-2 space-y-1 text-sm text-blue-900">
                    <p><span className="font-semibold">Role:</span> {getRoleDisplay(pendingAccountSave.payload.role)}</p>
                    {pendingAccountSave.payload.role === 'branch_staff' ? (
                      <p><span className="font-semibold">Assigned queue role:</span> {getServiceWindowLabel(pendingAccountSave.payload.service_window)} - Window {pendingAccountSave.payload.assigned_window_number || 1}</p>
                    ) : null}
                    <p><span className="font-semibold">Email login:</span> {pendingAccountSave.payload.email}</p>
                    {pendingAccountSave.payload.username ? (
                      <p><span className="font-semibold">Username:</span> {pendingAccountSave.payload.username}</p>
                    ) : null}
                    {pendingAccountSave.payload.full_name ? (
                      <p><span className="font-semibold">Full name:</span> {pendingAccountSave.payload.full_name}</p>
                    ) : null}
                    <p><span className="font-semibold">Status:</span> {pendingAccountSave.payload.status}</p>
                    {pendingAccountSave.payload.password ? (
                      <p><span className="font-semibold">Password:</span> Will be replaced with the new value you entered.</p>
                    ) : (
                      <p><span className="font-semibold">Password:</span> No password change.</p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{verifierLabel} Password</label>
                <PasswordField
                  value={authModal.password}
                  onChange={(event) => setAuthModal((previous) => ({ ...previous, password: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                  placeholder="Enter your password"
                />
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <div>
                      <p className="font-semibold text-red-800">{error}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={closeAuthModal}
                  className="w-full rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500/20 sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmProtectedAction}
                  disabled={loading}
                  className="w-full rounded-xl bg-red-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-600 sm:w-auto"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                      </svg>
                      Verifying...
                    </span>
                  ) : (
                    'Confirm ' + (authModal.mode === 'edit' ? 'Update' : 
                                  authModal.mode === 'deactivate' ? 'Deactivation' : 
                                  'Deletion')
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Accounts;
