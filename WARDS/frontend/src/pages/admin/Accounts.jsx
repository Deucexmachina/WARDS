import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { accountAPI, branchAPI } from '../../services/api';
import {
  getEmailValidationMessage,
  normalizeCitizenFullName,
  normalizePhilippineContactDigits,
  validateCitizenFullName,
  validatePhilippineContactDigits,
  validateStrongPassword,
} from '../../utils/validation';
import { formatUtc8DateTime } from '../../utils/dateTime';
import WardsPageHero from '../../components/WardsPageHero';
import PasswordField from '../../components/PasswordField';
import SystemMessageModal from '../../components/SystemMessageModal';

const DEFAULT_PAGE_SIZE = 100;
const INTERNAL_BRANCH_EMAIL_PATTERN = /^[A-Za-z0-9._-]+@branch\.local$/i;

const EMPTY_FORM = {
  username: '',
  email: '',
  password: '',
  full_name: '',
  contact_number: '',
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
const READ_ONLY_INPUT_CLASS = 'w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-medium text-slate-500 shadow-sm';
const EDITABLE_INPUT_CLASS = 'w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none';

const Accounts = () => {
  const location = useLocation();
  const isBranchPortal = location.pathname.includes('/branch-dashboard/');
  const currentManager = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(isBranchPortal ? 'branchUser' : 'adminUser') || '{}');
    } catch {
      return {};
    }
  }, [isBranchPortal]);

  const isBranchAdminManager = isBranchPortal && (currentManager?.internal_role === 'branch_admin' || currentManager?.role === 'branch_admin');
  const canCreateAccounts = !isBranchPortal;
  const verifierLabel = currentManager?.internal_role === 'superadmin' ? 'Super Admin' : isBranchPortal ? 'Branch Admin' : 'Main Admin';
  const verifierLabelLower = verifierLabel.toLowerCase();

  const [accounts, setAccounts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [pendingAccountSave, setPendingAccountSave] = useState(null);
  const [authModal, setAuthModal] = useState({
    mode: null,
    account: null,
    password: '',
  });
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
    total: 0,
    total_pages: 1,
  });
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [emailError, setEmailError] = useState('');
  const [contactError, setContactError] = useState('');
  const [contactCheckingUniqueness, setContactCheckingUniqueness] = useState(false);
  const [fullNameError, setFullNameError] = useState('');
  const [authPasswordError, setAuthPasswordError] = useState('');
  const [jumpPage, setJumpPage] = useState('');
  const [actionModal, setActionModal] = useState({
    open: false,
    tone: 'info',
    title: '',
    message: '',
    buttonLabel: 'OK',
  });

  const managerEyebrow = isBranchPortal ? 'Branch Admin Dashboard' : 'Main Admin Dashboard';
  const managerSubtitle = isBranchPortal
    ? 'Review and manage branch staff, branch admins, and citizen accounts connected to your assigned branch.'
    : 'Create, review, and maintain main admin, branch, and citizen accounts.';

  const isCitizenAccount = formData.role === 'public';

  const getServiceWindowLabel = (value) => {
    if (value === 'BUSINESS') return 'BT';
    return value || 'Not Assigned';
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

  const getAccountEmailValidationMessage = (email, role) => {
    const trimmedEmail = String(email || '').trim();
    if (role === 'branch_staff' && INTERNAL_BRANCH_EMAIL_PATTERN.test(trimmedEmail)) {
      return '';
    }
    return getEmailValidationMessage(trimmedEmail);
  };

  const renderReadOnlyField = (label, value) => (
    <div>
      <label className="mb-2 block text-sm font-semibold text-slate-700">{label}</label>
      <input type="text" readOnly value={value || 'N/A'} className={READ_ONLY_INPUT_CLASS} />
    </div>
  );

  useEffect(() => {
    fetchAccounts(1);
    if (canCreateAccounts) {
      fetchBranches();
    }

    const handleAccountsRefresh = () => {
      fetchAccounts(pagination.page);
      if (canCreateAccounts) {
        fetchBranches();
      }
    };

    window.addEventListener('wards-accounts-refresh', handleAccountsRefresh);
    return () => window.removeEventListener('wards-accounts-refresh', handleAccountsRefresh);
  }, [canCreateAccounts, pagination.page]);

  const fetchAccounts = async (page = pagination.page) => {
    try {
      setLoading(true);
      const response = await accountAPI.getAll({
        page,
        page_size: pagination.page_size,
        ...(isBranchPortal && currentManager?.branch_id ? { branch_id: currentManager.branch_id } : {}),
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
    } catch (fetchError) {
      console.error('Failed to fetch accounts:', fetchError);
      setError(fetchError.response?.data?.detail || 'Failed to load accounts.');
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const response = await branchAPI.getAll();
      setBranches(response.data || []);
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
    const totalPages = Math.max(1, Number(pagination.total_pages || 1));
    const clampedPage = Math.min(Math.max(1, Number(nextPage || 1)), totalPages);
    if (clampedPage === pagination.page) {
      return;
    }
    fetchAccounts(clampedPage);
  };

  const submitJump = (event) => {
    event.preventDefault();
    handlePageChange(jumpPage || pagination.page);
    setJumpPage('');
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;

    if (editingAccount) {
      if (name === 'email') {
        setFormData((current) => ({ ...current, email: value }));
        setEmailError(getAccountEmailValidationMessage(value, formData.role));
      } else if (name === 'contact_number') {
        const normalizedContact = normalizePhilippineContactDigits(value);
        setFormData((current) => ({ ...current, contact_number: normalizedContact }));
        setContactError(validatePhilippineContactDigits(normalizedContact));
      } else if (name === 'password') {
        setFormData((current) => ({ ...current, password: value }));
      }
      setError('');
      return;
    }

    if (name === 'role') {
      const nextState = { ...formData, role: value };
      if (value !== 'branch_staff') {
        nextState.service_window = '';
        nextState.assigned_window_number = 1;
      }
      setFormData(nextState);
      setEmailError(getAccountEmailValidationMessage(nextState.email, value));
      setError('');
      return;
    }

    if (name === 'contact_number') {
      const normalizedContact = normalizePhilippineContactDigits(value);
      setFormData((current) => ({ ...current, contact_number: normalizedContact }));
      setContactError(validatePhilippineContactDigits(normalizedContact));
      setError('');
      return;
    }

    const nextState = { ...formData, [name]: value };
    setFormData(nextState);
    if (name === 'email') {
      setEmailError(getAccountEmailValidationMessage(value, formData.role));
    }
    if (name === 'full_name') {
      const normalized = normalizeCitizenFullName(value);
      setFullNameError(validateCitizenFullName(normalized));
    }
    setError('');
  };

  const handleContactBlur = async () => {
    if (formData.role !== 'public') return;
    const digits = formData.contact_number;
    if (!digits || validatePhilippineContactDigits(digits)) return;
    setContactCheckingUniqueness(true);
    try {
      const response = await axios.post('http://localhost:8000/api/user/auth/check-contact', {
        contact_number: `+63${digits}`,
        exclude_citizen_id: editingAccount?.id ?? null,
      });
      if (!response.data.available) {
        setContactError('This contact number is unavailable. Please enter a different contact number.');
      }
    } catch {
      // silently skip — server-side enforces on save
    } finally {
      setContactCheckingUniqueness(false);
    }
  };

  const handleAddAccount = () => {
    setEditingAccount(null);
    setFormData(EMPTY_FORM);
    setEmailError('');
    setContactError('');
    setFullNameError('');
    setAuthPasswordError('');
    setError('');
    setSuccessMessage('');
    setShowModal(true);
  };

  const handleEditAccount = (account) => {
    setEditingAccount(account);
    setFormData({
      username: account.username || '',
      email: account.email || '',
      password: '',
      full_name: account.full_name || '',
      contact_number: account.contact_number ? normalizePhilippineContactDigits(account.contact_number) : '',
      role: account.role,
      branch_id: account.branch_id,
      service_window: account.service_window || '',
      assigned_window_number: account.assigned_window_number || 1,
      status: account.status || 'Active',
    });
    setEmailError('');
    setContactError('');
    setFullNameError('');
    setAuthPasswordError('');
    setError('');
    setSuccessMessage('');
    setShowModal(true);
  };

  const handleSaveAccount = async () => {
    if (isBranchPortal && !isBranchAdminManager) {
      setError('Only Branch Admin accounts can manage branch accounts.');
      return;
    }

    const needsUsername = ['main_admin', 'admin', 'branch_admin', 'branch_staff'].includes(formData.role);
    const needsFullName = formData.role === 'public';

    if (!formData.email || !formData.role || (!editingAccount && needsUsername && !formData.username) || (!editingAccount && needsFullName && !formData.full_name)) {
      setError('Please fill in all required fields.');
      return;
    }

    const nextEmailError = getAccountEmailValidationMessage(formData.email, formData.role);
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setError('Please correct the highlighted email field.');
      return;
    }

    if (editingAccount && formData.role === 'public') {
      const nextContactError = validatePhilippineContactDigits(formData.contact_number || '');
      if (formData.contact_number && nextContactError) {
        setContactError(nextContactError);
        setError('Please correct the highlighted contact number field.');
        return;
      }
    }

    if (!editingAccount && formData.full_name) {
      const normalizedFullName = normalizeCitizenFullName(formData.full_name);
      const nextFullNameError = validateCitizenFullName(normalizedFullName);
      if (nextFullNameError) {
        setFullNameError(nextFullNameError);
        setError('Please correct the highlighted full name field.');
        return;
      }
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

    if (!editingAccount && (formData.role === 'branch_admin' || formData.role === 'branch_staff') && !formData.branch_id) {
      setError('Please assign a branch for branch accounts.');
      return;
    }

    if (!editingAccount && formData.role === 'branch_staff' && !formData.service_window) {
      setError('Please select the assigned queue/service role for this branch staff account.');
      return;
    }

    if (!editingAccount && formData.role === 'branch_staff') {
      const assignedWindowNumber = Number.parseInt(formData.assigned_window_number, 10);
      if (Number.isNaN(assignedWindowNumber) || assignedWindowNumber < 1 || assignedWindowNumber > 5) {
        setError('Please assign a physical window from 1 to 5 for this branch staff account.');
        return;
      }
    }

    try {
      setLoading(true);
      setError('');
      setSuccessMessage('');

      if (editingAccount) {
        const updatePayload = {
          role: formData.role,
          email: formData.email,
        };

        if (formData.password) {
          updatePayload.password = formData.password;
        }

        if (formData.role === 'public') {
          updatePayload.contact_number = formData.contact_number || '';
        }

        setPendingAccountSave({
          id: editingAccount.id,
          payload: updatePayload,
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

  const handleDeactivateAccount = (account) => {
    setError('');
    setSuccessMessage('');
    setAuthModal({
      mode: 'deactivate',
      account,
      password: '',
    });
  };

  const handleActivateAccount = (account) => {
    setError('');
    setSuccessMessage('');
    setAuthModal({
      mode: 'activate',
      account,
      password: '',
    });
  };

  const handleDeleteAccount = (account) => {
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
    setAuthPasswordError('');
    setAuthModal({ mode: null, account: null, password: '' });
    setPendingAccountSave(null);
  };

  const openActionModal = ({ tone, title, message, buttonLabel = 'OK' }) => {
    setActionModal({
      open: true,
      tone,
      title,
      message,
      buttonLabel,
    });
  };

  const handleConfirmProtectedAction = async () => {
    if (!authModal.password) {
      setAuthPasswordError(`Please enter your ${verifierLabelLower} password to continue.`);
      setError('');
      return;
    }

    setAuthPasswordError('');
    setError('');

    try {
      setLoading(true);
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
        openActionModal({
          tone: 'success',
          title: 'Account Deactivated Successfully',
          message: 'The selected account has been successfully deactivated.',
          buttonLabel: 'OK',
        });
        window.dispatchEvent(new Event('wards-accounts-refresh'));
      }

      if (authModal.mode === 'activate' && authModal.account) {
        await accountAPI.activate(authModal.account.id, authModal.account.role, {
          current_admin_password: authModal.password,
        });
        await fetchAccounts(pagination.page);
        openActionModal({
          tone: 'success',
          title: 'Account Activated Successfully',
          message: 'The selected account has been successfully activated.',
          buttonLabel: 'OK',
        });
        window.dispatchEvent(new Event('wards-accounts-refresh'));
      }

      if (authModal.mode === 'delete' && authModal.account) {
        await accountAPI.delete(authModal.account.id, authModal.account.role, {
          current_admin_password: authModal.password,
        }, {
          suppressGlobalErrorModal: true,
        });
        const nextPage = accounts.length === 1 && pagination.page > 1 ? pagination.page - 1 : pagination.page;
        await fetchAccounts(nextPage);
        openActionModal({
          tone: 'success',
          title: 'Account Deleted Successfully',
          message: 'The selected account has been successfully deleted.',
          buttonLabel: 'OK',
        });
        window.dispatchEvent(new Event('wards-accounts-refresh'));
      }

      closeAuthModal();
    } catch (actionError) {
      console.error('Failed to complete protected account action:', actionError);
      const errorDetail = actionError.response?.data?.detail || 'Failed to complete account action.';
      if (errorDetail.toLowerCase().includes('incorrect') && errorDetail.toLowerCase().includes('password')) {
        setAuthPasswordError('Incorrect password. Please try again.');
        setError('');
      } else {
        if (authModal.mode === 'delete') {
          openActionModal({
            tone: 'error',
            title: 'Deletion Failed',
            message: 'An error occurred while deleting the account. Please try again.',
            buttonLabel: 'OK',
          });
        } else {
          setError(errorDetail);
        }
        setAuthPasswordError('');
      }
    } finally {
      setLoading(false);
    }
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
            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">{primaryLabel}</th>
            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Email</th>
            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Branch</th>
            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Role</th>
            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Queue Role</th>
            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Status</th>
            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Last Login</th>
            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {rows.length === 0 ? (
            <tr>
              <td colSpan="8" className="px-6 py-6 text-center text-sm text-gray-500">No accounts found.</td>
            </tr>
          ) : rows.map((account) => (
            <tr key={`${account.role}-${account.id}`} className="transition duration-200 hover:bg-gray-50">
              <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                {account.username || account.full_name || 'N/A'}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">{account.email}</td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">{account.branch_name || 'All Branches'}</td>
              <td className="whitespace-nowrap px-6 py-4">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getRoleColor(account.role)}`}>
                  {getRoleDisplay(account.role)}
                </span>
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                {account.role === 'branch_staff'
                  ? `${getServiceWindowLabel(account.service_window_label || account.service_window)} - Window ${account.assigned_window_number || 1}`
                  : account.role === 'branch_admin'
                    ? 'Full Branch'
                    : 'N/A'}
              </td>
              <td className="whitespace-nowrap px-6 py-4">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${account.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {account.status}
                </span>
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                {account.last_login ? formatUtc8DateTime(account.last_login) : 'Never'}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm space-x-2">
                <button
                  onClick={() => handleEditAccount(account)}
                  className="rounded-lg bg-accent px-3 py-1 font-semibold text-white transition duration-300 hover:bg-blue-600"
                >
                  Edit
                </button>
                {account.status === 'Active' && (
                  <button
                    onClick={() => handleDeactivateAccount(account)}
                    className="rounded-lg bg-yellow-500 px-3 py-1 font-semibold text-white transition duration-300 hover:bg-yellow-600"
                  >
                    Deactivate
                  </button>
                )}
                {account.status === 'Inactive' && (
                  <button
                    onClick={() => handleActivateAccount(account)}
                    className="rounded-lg bg-green-500 px-3 py-1 font-semibold text-white transition duration-300 hover:bg-green-600"
                  >
                    Activate
                  </button>
                )}
                <button
                  onClick={() => handleDeleteAccount(account)}
                  className="rounded-lg bg-red-500 px-3 py-1 font-semibold text-white transition duration-300 hover:bg-red-600"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderAccountTable = (title, rows, primaryLabel = 'Username') => (
    <div className="mb-6 overflow-hidden rounded-xl bg-white shadow-lg">
      <div className="bg-primary px-6 py-4">
        <h3 className="text-xl font-bold text-white">{title}</h3>
      </div>
      {renderAccountRows(rows, primaryLabel)}
    </div>
  );

  const renderBranchAccountTable = () => (
    <div className="mb-6 overflow-hidden rounded-xl bg-white shadow-lg">
      <div className="bg-primary px-6 py-4">
        <h3 className="text-xl font-bold text-white">Branch Accounts</h3>
        <p className="mt-1 text-sm text-blue-100">
          Accounts are grouped by branch so branch admins and branch staff stay together as branches grow.
        </p>
      </div>

      {sortedBranchGroups.length === 0 ? (
        <div className="px-6 py-6 text-center text-sm text-gray-500">No branch accounts found.</div>
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

  if (loading && accounts.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-gray-600">Loading accounts...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WardsPageHero
        eyebrow={managerEyebrow}
        title="Account Management"
        subtitle={managerSubtitle}
        actions={canCreateAccounts ? (
          <button
            onClick={handleAddAccount}
            className="rounded-lg bg-green-500 px-6 py-3 font-semibold text-white shadow-lg transition duration-300 hover:bg-green-600"
          >
            + Create Account
          </button>
        ) : null}
      />

      <div className="mt-6">
      {error && !authModal.mode && (
        <div className="mb-6 rounded border-l-4 border-red-500 bg-red-100 p-4 text-red-700">
          <p className="font-semibold">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="mb-6 rounded border-l-4 border-green-500 bg-green-100 p-4 text-green-700">
          <p className="font-semibold">{successMessage}</p>
        </div>
      )}

      {!isBranchPortal && renderAccountTable('Main Admin Accounts', adminAccounts)}
      {renderBranchAccountTable()}
      {renderAccountTable('Citizen Accounts', citizenAccounts, 'Full Name')}
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-100 px-2 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          Showing page {pagination.page} of {pagination.total_pages} · {pagination.total} total account{pagination.total === 1 ? '' : 's'}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <form onSubmit={submitJump} className="flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-600">Jump to</label>
            <input
              type="number"
              min="1"
              max={Math.max(1, Number(pagination.total_pages || 1))}
              value={jumpPage}
              onChange={(event) => setJumpPage(event.target.value)}
              placeholder={String(pagination.page || 1)}
              className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button type="submit" disabled={loading} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60">Go</button>
          </form>
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 px-4 py-6">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
            <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-6 py-5 md:px-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                  {editingAccount ? 'Account Review' : 'Create Account'}
                </p>
                <h3 className="mt-2 text-2xl font-bold text-slate-900">
                  {editingAccount ? 'Edit Account' : 'Create Account'}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {editingAccount
                    ? 'Only email, password, and contact number can be changed here. All other account details remain visible but read-only.'
                    : 'Create a new account with the required branch, role, and access settings.'}
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-2xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close modal"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-8">
              {error && (
                <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {error}
                </div>
              )}

              {editingAccount ? (
                <div className="space-y-6">
                  <div>
                    <h4 className="mb-4 text-lg font-semibold text-slate-900">View-Only Account Details</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {renderReadOnlyField(formData.role === 'public' ? 'Full Name' : 'Username', formData.role === 'public' ? formData.full_name : formData.username)}
                      {renderReadOnlyField('Role', getRoleDisplay(formData.role))}
                      {renderReadOnlyField('Branch Assignment', formData.branch_id ? (editingAccount?.branch_name || `Branch ${formData.branch_id}`) : 'All Branches')}
                      {renderReadOnlyField('Account Type', formData.role === 'public' ? 'Citizen Account' : 'Employee Account')}
                      {renderReadOnlyField('Status', formData.status)}
                      {renderReadOnlyField('Created Date', editingAccount?.created_at ? formatUtc8DateTime(editingAccount.created_at) : 'N/A')}
                      {formData.role !== 'public' && renderReadOnlyField('Full Name', formData.full_name || 'N/A')}
                      {formData.role === 'branch_staff' && renderReadOnlyField('Queue Assignment', `${getServiceWindowLabel(formData.service_window)} - Window ${formData.assigned_window_number || 1}`)}
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-4 text-lg font-semibold text-slate-900">Editable Information</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className={isCitizenAccount ? '' : 'sm:col-span-2'}>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Email Address</label>
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleInputChange}
                          className={`${EDITABLE_INPUT_CLASS} ${emailError ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                          placeholder="Enter email address"
                        />
                        {emailError && <p className="mt-2 text-sm font-medium text-red-600">{emailError}</p>}
                      </div>

                      {isCitizenAccount && (
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Contact Number</label>
                          <div className={`flex overflow-hidden rounded-2xl border ${contactError ? 'border-red-300 bg-red-50' : 'border-slate-300 bg-white'}`}>
                            <span className="flex items-center bg-slate-100 px-4 font-semibold text-slate-700">+63</span>
                            <input
                              type="text"
                              name="contact_number"
                              value={formData.contact_number}
                              onChange={handleInputChange}
                              onBlur={handleContactBlur}
                              inputMode="numeric"
                              maxLength={10}
                              className="w-full px-4 py-3 text-sm font-medium text-slate-900 outline-none"
                              placeholder="9123456789"
                            />
                          </div>
                          {contactError && <p className="mt-2 text-sm font-medium text-red-600">{contactError}</p>}
                        </div>
                      )}

                      <div className="sm:col-span-2">
                        <label className="mb-2 block text-sm font-semibold text-slate-700">
                          New Password (leave blank to keep current)
                        </label>
                        <PasswordField
                          name="password"
                          value={formData.password}
                          onChange={handleInputChange}
                          className={EDITABLE_INPUT_CLASS}
                          placeholder="Enter new password"
                        />
                        <p className="mt-2 text-xs text-slate-500">
                          Password must be more than 12 characters with uppercase, lowercase, and a number or special character.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <h4 className="mb-4 text-lg font-semibold text-slate-900">Account Information</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {formData.role === 'public' ? (
                        <div className="sm:col-span-2">
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Full Name</label>
                          <input
                            type="text"
                            name="full_name"
                            value={formData.full_name}
                            onChange={handleInputChange}
                            className={`${EDITABLE_INPUT_CLASS} ${fullNameError ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                            placeholder="Enter full name"
                          />
                          {fullNameError && <p className="mt-2 text-sm font-medium text-red-600">{fullNameError}</p>}
                        </div>
                      ) : (
                        <>
                          <div>
                            <label className="mb-2 block text-sm font-semibold text-slate-700">Username</label>
                            <input
                              type="text"
                              name="username"
                              value={formData.username}
                              onChange={handleInputChange}
                              maxLength={32}
                              className={EDITABLE_INPUT_CLASS}
                              placeholder="Enter username"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-semibold text-slate-700">Full Name</label>
                            <input
                              type="text"
                              name="full_name"
                              value={formData.full_name}
                              onChange={handleInputChange}
                              className={`${EDITABLE_INPUT_CLASS} ${fullNameError ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                              placeholder="Enter full name (optional)"
                            />
                            {fullNameError && <p className="mt-2 text-sm font-medium text-red-600">{fullNameError}</p>}
                          </div>
                        </>
                      )}

                      <div className="sm:col-span-2">
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Email Address</label>
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleInputChange}
                          className={`${EDITABLE_INPUT_CLASS} ${emailError ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                          placeholder="Enter email address"
                        />
                        {emailError && <p className="mt-2 text-sm font-medium text-red-600">{emailError}</p>}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-4 text-lg font-semibold text-slate-900">Security</h4>
                    <PasswordField
                      name="password"
                      value={formData.password}
                      onChange={handleInputChange}
                      className={EDITABLE_INPUT_CLASS}
                      placeholder="Enter password"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Password must be more than 12 characters with uppercase, lowercase, and a number or special character.
                    </p>
                  </div>

                  <div>
                    <h4 className="mb-4 text-lg font-semibold text-slate-900">Access Control</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Role</label>
                        <select
                          name="role"
                          value={formData.role}
                          onChange={handleInputChange}
                          className={EDITABLE_INPUT_CLASS}
                          required
                        >
                          <option value="main_admin">Main Office Admin</option>
                          <option value="branch_admin">Branch Admin</option>
                          <option value="branch_staff">Branch Staff</option>
                          <option value="public">Citizen</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Status</label>
                        <select
                          name="status"
                          value={formData.status}
                          onChange={handleInputChange}
                          className={EDITABLE_INPUT_CLASS}
                        >
                          <option value="Active">Active</option>
                          <option value="Inactive">Inactive</option>
                        </select>
                      </div>
                    </div>

                    {(formData.role === 'branch_admin' || formData.role === 'branch_staff') && (
                      <div className="mt-4 space-y-4">
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700">Branch Assignment</label>
                          <select
                            name="branch_id"
                            value={formData.branch_id || ''}
                            onChange={(event) => setFormData((current) => ({ ...current, branch_id: event.target.value ? parseInt(event.target.value, 10) : null }))}
                            className={EDITABLE_INPUT_CLASS}
                            required
                          >
                            <option value="">Select Branch</option>
                            {branches.map((branch) => (
                              <option key={branch.id} value={branch.id}>{branch.name}</option>
                            ))}
                          </select>
                        </div>

                        {formData.role === 'branch_staff' && (
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700">Assigned Queue / Service Role</label>
                              <select
                                name="service_window"
                                value={formData.service_window}
                                onChange={handleInputChange}
                                className={EDITABLE_INPUT_CLASS}
                                required
                              >
                                <option value="">Select Queue / Service Role</option>
                                {SERVICE_WINDOW_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700">Voice Announcement Window</label>
                              <select
                                name="assigned_window_number"
                                value={formData.assigned_window_number || 1}
                                onChange={(event) => setFormData((current) => ({ ...current, assigned_window_number: Number.parseInt(event.target.value, 10) }))}
                                className={EDITABLE_INPUT_CLASS}
                                required
                              >
                                {PHYSICAL_WINDOW_OPTIONS.map((windowNumber) => (
                                  <option key={windowNumber} value={windowNumber}>Window {windowNumber}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 rounded-b-[28px] border-t border-slate-200 bg-slate-50 px-6 py-4 md:px-8">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setShowModal(false)}
                  className="w-full rounded-2xl bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAccount}
                  disabled={loading || contactCheckingUniqueness}
                  className="w-full rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {loading ? 'Saving...' : editingAccount ? 'Save Changes' : 'Create Account'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {authModal.mode && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 px-4 py-6">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
            <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-6 py-5 md:px-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Protected Action</p>
                <h3 className="mt-2 text-2xl font-bold text-slate-900">
                  {authModal.mode === 'edit' ? 'Verify Account Update' : authModal.mode === 'deactivate' ? 'Verify Account Deactivation' : authModal.mode === 'activate' ? 'Verify Account Activation' : 'Verify Account Deletion'}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Review the change, then confirm your identity to proceed.
                </p>
              </div>
              <button
                onClick={closeAuthModal}
                className="rounded-2xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close modal"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-8">
              <p className="mb-6 text-sm text-slate-600">
                Enter your {verifierLabelLower} password to {authModal.mode} the account
                {authModal.account?.username
                  ? ` "${authModal.account.username}"`
                  : authModal.account?.full_name
                    ? ` "${authModal.account.full_name}"`
                    : ''}
                .
              </p>

              {authModal.mode === 'edit' && pendingAccountSave && (
                <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <p className="text-sm font-semibold text-blue-900">Update Summary</p>
                  <div className="mt-2 space-y-1 text-sm text-blue-900">
                    <p><span className="font-semibold">Role:</span> {getRoleDisplay(pendingAccountSave.payload.role)}</p>
                    <p><span className="font-semibold">Email:</span> {pendingAccountSave.payload.email}</p>
                    {pendingAccountSave.payload.contact_number !== undefined && (
                      <p><span className="font-semibold">Contact Number:</span> {pendingAccountSave.payload.contact_number ? `+63 ${pendingAccountSave.payload.contact_number}` : 'Cleared'}</p>
                    )}
                    <p><span className="font-semibold">Password:</span> {pendingAccountSave.payload.password ? 'Will be replaced with the new value you entered.' : 'No password change.'}</p>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">{verifierLabel} Password</label>
                <PasswordField
                  value={authModal.password}
                  onChange={(event) => {
                    setAuthModal((previous) => ({ ...previous, password: event.target.value }));
                    setAuthPasswordError('');
                  }}
                  className={`${EDITABLE_INPUT_CLASS} ${authPasswordError ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                  placeholder="Enter your password"
                />
                {authPasswordError && <p className="mt-2 text-sm font-medium text-red-600">{authPasswordError}</p>}
              </div>

              {error && (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {error}
                </div>
              )}
            </div>

            <div className="shrink-0 rounded-b-[28px] border-t border-slate-200 bg-slate-50 px-6 py-4 md:px-8">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  onClick={closeAuthModal}
                  className="w-full rounded-2xl bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmProtectedAction}
                  disabled={loading}
                  className="w-full rounded-2xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {loading ? 'Verifying...' : `Confirm ${authModal.mode === 'edit' ? 'Update' : authModal.mode === 'deactivate' ? 'Deactivation' : authModal.mode === 'activate' ? 'Activation' : 'Deletion'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <SystemMessageModal
        open={actionModal.open}
        tone={actionModal.tone}
        title={actionModal.title}
        message={actionModal.message}
        buttonLabel={actionModal.buttonLabel}
        onClose={() => setActionModal({
          open: false,
          tone: 'info',
          title: '',
          message: '',
          buttonLabel: 'OK',
        })}
      />
    </div>
  );
};

export default Accounts;
