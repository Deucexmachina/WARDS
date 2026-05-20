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
  status: 'Active',
};

const BRANCH_ACCOUNT_ROLE_ORDER = {
  branch_admin: 0,
  branch_staff: 1,
};

const Accounts = () => {
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

  const handlePageChange = (nextPage) => {
    if (nextPage < 1 || nextPage > pagination.total_pages || nextPage === pagination.page) {
      return;
    }
    setLoading(true);
    fetchAccounts(nextPage);
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData({ ...formData, [name]: value });
    if (name === 'email') {
      setEmailError(getEmailValidationMessage(value));
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

    const nextEmailError = getEmailValidationMessage(formData.email);
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
    setAuthModal({ mode: null, account: null, password: '' });
    setPendingAccountSave(null);
  };

  const handleConfirmProtectedAction = async () => {
    if (!authModal.password) {
      setError('Please enter your main admin password to continue.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccessMessage('');

      if (authModal.mode === 'edit' && pendingAccountSave) {
        await accountAPI.update(pendingAccountSave.id, {
          ...pendingAccountSave.payload,
          current_admin_password: authModal.password,
        });
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
      branch_admin: 'Branch Admin',
      branch_staff: 'Branch Staff',
      admin: 'Admin',
      public: 'Citizen',
    };
    return roleMap[role] || role;
  };

  const getRoleColor = (role) => {
    if (role === 'main_admin' || role === 'admin') return 'bg-purple-100 text-purple-800';
    if (role === 'branch_admin') return 'bg-blue-100 text-blue-800';
    if (role === 'branch_staff') return 'bg-sky-100 text-sky-800';
    if (role === 'public') return 'bg-emerald-100 text-emerald-800';
    return 'bg-gray-100 text-gray-800';
  };

  const adminAccounts = accounts.filter((account) => account.role === 'main_admin' || account.role === 'admin');
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
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Last Login</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.length === 0 ? (
            <tr>
              <td colSpan="7" className="px-6 py-6 text-sm text-center text-gray-500">No accounts found.</td>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4">
            <h3 className="text-2xl font-bold text-primary mb-6">
              {editingAccount ? 'Edit Account' : 'Create Account'}
            </h3>
            {error && (
              <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
                <p className="font-semibold">{error}</p>
              </div>
            )}
            <div className="space-y-4">
              {formData.role === 'public' ? (
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">Full Name</label>
                  <input
                    type="text"
                    name="full_name"
                    value={formData.full_name}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">Username</label>
                  <input
                    type="text"
                    name="username"
                    value={formData.username}
                    onChange={handleInputChange}
                    maxLength={32}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  />
                </div>
              )}
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  pattern="^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent ${
                    emailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                />
                {emailError ? (
                  <p className="mt-2 text-sm font-semibold text-red-600">{emailError}</p>
                ) : null}
              </div>
              {formData.role !== 'public' && (
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">Full Name</label>
                  <input
                    type="text"
                    name="full_name"
                    value={formData.full_name}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  />
                </div>
              )}
              <div>
                <label className="block text-gray-700 font-semibold mb-2">
                  {editingAccount ? 'New Password (leave blank to keep current)' : 'Password'}
                </label>
                <PasswordField
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                />
                <p className="mt-2 text-sm text-gray-500">
                  Password must be more than 12 characters with uppercase, lowercase, and a number or special character.
                </p>
                {editingAccount && (
                  <p className="mt-2 text-sm text-amber-700">
                    Saving changes will require your main admin password for verification.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Role</label>
                <select
                  name="role"
                  value={formData.role}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  required
                >
                  <option value="main_admin">Main Office Admin</option>
                  <option value="branch_admin">Branch Admin</option>
                  <option value="branch_staff">Branch Staff</option>
                  <option value="public">Citizen</option>
                </select>
              </div>
              {(formData.role === 'branch_admin' || formData.role === 'branch_staff') && (
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">Branch</label>
                  <select
                    name="branch_id"
                    value={formData.branch_id || ''}
                    onChange={(event) => setFormData({ ...formData, branch_id: event.target.value ? parseInt(event.target.value, 10) : null })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                    required
                  >
                    <option value="">Select Branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Status</label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-semibold transition duration-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAccount}
                disabled={loading}
                className="flex-1 bg-primary hover:bg-secondary text-white py-3 rounded-lg font-semibold transition duration-300 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {authModal.mode && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4">
            <h3 className="text-2xl font-bold text-primary mb-3">
              {authModal.mode === 'edit' ? 'Verify Account Update' : authModal.mode === 'deactivate' ? 'Verify Account Deactivation' : 'Verify Account Deletion'}
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              Enter your main admin password to {authModal.mode} the account
              {authModal.account?.username
                ? ` "${authModal.account.username}"`
                : authModal.account?.full_name
                ? ` "${authModal.account.full_name}"`
                : ''}
              .
            </p>
            <div>
              <label className="block text-gray-700 font-semibold mb-2">Main Admin Password</label>
              <PasswordField
                value={authModal.password}
                onChange={(event) => setAuthModal((previous) => ({ ...previous, password: event.target.value }))}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="Enter your password"
              />
            </div>
            <div className="flex gap-4 mt-6">
              <button
                onClick={closeAuthModal}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-semibold transition duration-300"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmProtectedAction}
                disabled={loading}
                className="flex-1 bg-primary hover:bg-secondary text-white py-3 rounded-lg font-semibold transition duration-300 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Accounts;
