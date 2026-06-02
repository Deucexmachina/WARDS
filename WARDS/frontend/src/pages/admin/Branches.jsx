import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { getEmailValidationMessage, validateStrongPassword } from '../../utils/validation';
import WardsPageHero from '../../components/WardsPageHero';
import PasswordField from '../../components/PasswordField';

const slugifyBranchName = (name) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'branch';
};

const buildBranchDashboardUrl = (name) => `http://localhost:3000/branch-dashboard/${slugifyBranchName(name)}`;

const BRANCH_PRESETS = [
  {
    id: 'galas',
    name: 'Galas',
    location: 'Unang Hakbang Street, Brgy. San Isidro',
    contact: '7005-0881',
  },
  {
    id: 'la-loma',
    name: 'La Loma',
    location: 'Mayon Street (near Police Station)',
    contact: '7005-5996',
  },
  {
    id: 'marilag',
    name: 'Marilag',
    location: '25 Calderon Street, Brgy. Marilag, Project 4',
    contact: '7278-7563',
  },
  {
    id: 'novaliches-district-center',
    name: 'Novaliches District Center',
    location: 'Jordan Plains Subd., NDC, Novaliches',
    contact: '7254-7296',
  },
  {
    id: 'talipapa',
    name: 'Talipapa',
    location: 'Brgy. Hall Talipapa, Quirino Hi-way, Novaliches',
    contact: '7118-7725, 8937-2389',
  },
  {
    id: 'paligsahan',
    name: 'Paligsahan',
    location: '65 Scout Reyes Street, Diliman',
    contact: '8988-4242 local 8320',
  },
];

const DEFAULT_PRESET_ID = BRANCH_PRESETS[0]?.id || 'custom';

const WINDOW_ACCOUNT_OPTIONS = [
  { key: 'W1', number: 1, label: 'Window 1', description: 'Queue-only staff account assigned to physical Window 1.' },
  { key: 'W2', number: 2, label: 'Window 2', description: 'Queue-only staff account assigned to physical Window 2.' },
  { key: 'W3', number: 3, label: 'Window 3', description: 'Queue-only staff account assigned to physical Window 3.' },
  { key: 'W4', number: 4, label: 'Window 4', description: 'Queue-only staff account assigned to physical Window 4.' },
  { key: 'W5', number: 5, label: 'Window 5', description: 'Queue-only staff account assigned to physical Window 5.' },
];

const MAX_QUEUE_WINDOWS = WINDOW_ACCOUNT_OPTIONS.length;
const SERVICE_WINDOW_CHOICES = [
  { key: 'RPT', label: 'RPT' },
  { key: 'BUSINESS', label: 'BT' },
  { key: 'MISC', label: 'MISC' },
];
const RESERVED_CUSTOM_WINDOW_LABELS = new Set([
  'RPT',
  'RPT_WINDOW',
  'REAL_PROPERTY_TAX',
  'REAL_PROPERTY_TAX_WINDOW',
  'BT',
  'BT_WINDOW',
  'BUSINESS',
  'BUSINESS_WINDOW',
  'BUSINESS_TAX',
  'BUSINESS_TAX_WINDOW',
  'MISC',
  'MISC_WINDOW',
  'MISCELLANEOUS',
  'MISCELLANEOUS_WINDOW',
]);
const DEFAULT_SERVICE_BY_WINDOW = {
  W1: 'RPT',
  W2: 'BUSINESS',
  W3: 'MISC',
  W4: 'OTHER',
  W5: 'OTHER',
};
const MAPTILER_API_KEY = 'qLnRCrJMrms1Y3hUUiPv';
const MAPTILER_STYLE_URL = `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_API_KEY}`;
const DEFAULT_MAP_CENTER = { lng: 121.0437, lat: 14.6760 };

const loadMapLibreAssets = () => new Promise((resolve, reject) => {
  if (window.maplibregl) {
    resolve(window.maplibregl);
    return;
  }

  const existingScript = document.querySelector('script[data-maplibre-loader="true"]');
  if (existingScript) {
    existingScript.addEventListener('load', () => resolve(window.maplibregl), { once: true });
    existingScript.addEventListener('error', () => reject(new Error('Failed to load MapLibre resources.')), { once: true });
    return;
  }

  if (!document.querySelector('link[data-maplibre-loader="true"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
    link.dataset.maplibreLoader = 'true';
    document.head.appendChild(link);
  }

  const script = document.createElement('script');
  script.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  script.async = true;
  script.dataset.maplibreLoader = 'true';
  script.onload = () => resolve(window.maplibregl);
  script.onerror = () => reject(new Error('Failed to load MapLibre resources.'));
  document.body.appendChild(script);
});

const fetchMapTilerJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Map location lookup failed.');
  }
  return response.json();
};

const EMPTY_WINDOW_ACCOUNTS = {
  W1: { assigned_window_number: 1, service_window: 'RPT' },
  W2: { assigned_window_number: 2, service_window: 'BUSINESS' },
  W3: { assigned_window_number: 3, service_window: 'MISC' },
  W4: { assigned_window_number: 4, service_window: 'OTHER', custom_label: '' },
  W5: { assigned_window_number: 5, service_window: 'OTHER', custom_label: '' },
};

const buildWindowAccountsState = (windowAccounts = []) => {
  const nextState = {
    ...EMPTY_WINDOW_ACCOUNTS,
    W1: { ...EMPTY_WINDOW_ACCOUNTS.W1 },
    W2: { ...EMPTY_WINDOW_ACCOUNTS.W2 },
    W3: { ...EMPTY_WINDOW_ACCOUNTS.W3 },
    W4: { ...EMPTY_WINDOW_ACCOUNTS.W4 },
    W5: { ...EMPTY_WINDOW_ACCOUNTS.W5 },
  };

  windowAccounts.forEach((account) => {
    const windowKey = `W${account.assigned_window_number}`;
    if (!nextState[windowKey]) {
      return;
    }

    const serviceWindow = account.service_window === 'QW4' || account.service_window === 'QW5'
      ? 'OTHER'
      : account.service_window;

    nextState[windowKey] = {
      ...nextState[windowKey],
      assigned_window_number: account.assigned_window_number || nextState[windowKey].assigned_window_number,
      service_window: serviceWindow,
      custom_label: serviceWindow === 'OTHER' ? (account.service_window_label || '') : '',
    };
  });

  return nextState;
};

const normalizeCustomWindowLabelKey = (value) => (
  (value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
);

const EMPTY_BRANCH_FORM = {
  name: BRANCH_PRESETS[0]?.name || '',
  location: BRANCH_PRESETS[0]?.location || '',
  contact: BRANCH_PRESETS[0]?.contact || '',
  dashboard_url: buildBranchDashboardUrl(BRANCH_PRESETS[0]?.name || 'branch'),
  counters: 1,
  status: 'Active',
  admin_username: '',
  admin_email: '',
  admin_password: ''
};

const EMPTY_AUTH_MODAL = {
  mode: null,
  branchId: null,
  branchName: '',
  password: '',
};

const Branches = () => {
  const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
  const isSuperadmin = adminUser?.internal_role === 'superadmin';
  const verifierLabel = isSuperadmin ? 'Super Admin' : 'Main Admin';
  const verifierLabelLower = verifierLabel.toLowerCase();
  const [branches, setBranches] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PRESET_ID);
  const [formData, setFormData] = useState(EMPTY_BRANCH_FORM);
  const [pageError, setPageError] = useState('');
  const [modalError, setModalError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [pendingNotice, setPendingNotice] = useState('');
  const [authModal, setAuthModal] = useState(EMPTY_AUTH_MODAL);
  const [authModalError, setAuthModalError] = useState('');
  const [isProtectedActionLoading, setIsProtectedActionLoading] = useState(false);
  const [pendingBranchSave, setPendingBranchSave] = useState(null);
  const [adminEmailError, setAdminEmailError] = useState('');
  const [windowAccounts, setWindowAccounts] = useState(EMPTY_WINDOW_ACCOUNTS);
  const [showMapPickerModal, setShowMapPickerModal] = useState(false);
  const [mapPickerLoading, setMapPickerLoading] = useState(false);
  const [mapPickerError, setMapPickerError] = useState('');
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [mapSearchResults, setMapSearchResults] = useState([]);
  const [selectedMapLocation, setSelectedMapLocation] = useState(null);
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const mapMarkerRef = useRef(null);

  const getNormalizedCounterCount = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return 1;
    }
    return Math.min(Math.max(parsed, 1), MAX_QUEUE_WINDOWS);
  };

  const getActiveWindowOptions = () => WINDOW_ACCOUNT_OPTIONS.slice(0, getNormalizedCounterCount(formData.counters));

  const getSelectedServiceWindow = (windowKey) => (
    windowAccounts[windowKey]?.service_window || DEFAULT_SERVICE_BY_WINDOW[windowKey] || 'MISC'
  );

  const getSelectedAssignedWindowNumber = (windowKey, fallbackNumber) => {
    const parsed = Number(windowAccounts[windowKey]?.assigned_window_number);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackNumber;
  };

  const getUsedServiceWindows = (currentWindowKey) => {
    const used = new Set();
    getActiveWindowOptions().forEach((option) => {
      if (option.key === currentWindowKey) {
        return;
      }
      const selectedServiceWindow = getSelectedServiceWindow(option.key);
      if (selectedServiceWindow && selectedServiceWindow !== 'OTHER') {
        used.add(selectedServiceWindow);
      }
    });
    return used;
  };

  const getUsedAssignedWindowNumbers = (currentWindowKey) => {
    const used = new Set();
    getActiveWindowOptions().forEach((option) => {
      if (option.key === currentWindowKey) {
        return;
      }
      used.add(getSelectedAssignedWindowNumber(option.key, option.number));
    });
    return used;
  };

  const isServiceChoiceUnavailable = (windowKey, choiceKey) => (
    choiceKey !== 'OTHER' && getUsedServiceWindows(windowKey).has(choiceKey)
  );

  const isAssignedWindowNumberUnavailable = (windowKey, windowNumber) => (
    getUsedAssignedWindowNumbers(windowKey).has(windowNumber)
  );

  const handleWindowAccountChange = (windowKey, field, value) => {
    setWindowAccounts((previous) => ({
      ...previous,
      [windowKey]: {
        ...(previous[windowKey] || {}),
        [field]: value,
        ...(field === 'service_window' && value !== 'OTHER' ? { custom_label: '' } : {}),
      },
    }));
    if (modalError) {
      setModalError('');
    }
  };

  const buildWindowAccountPayload = (counterCount) => (
    WINDOW_ACCOUNT_OPTIONS
      .slice(0, counterCount)
      .map((option) => {
        const account = windowAccounts[option.key] || {};
        const serviceWindow = account.service_window || DEFAULT_SERVICE_BY_WINDOW[option.key] || 'MISC';
        return {
          service_window: serviceWindow,
          assigned_window_number: getSelectedAssignedWindowNumber(option.key, option.number),
          custom_label: serviceWindow === 'OTHER' ? (account.custom_label || '').trim() : undefined,
        };
      })
  );

  const validateWindowAccountPayload = (windowAccountPayload) => {
    const usedServiceWindows = new Set();
    const usedAssignedWindowNumbers = new Set();
    for (const account of windowAccountPayload) {
      if (usedAssignedWindowNumbers.has(account.assigned_window_number)) {
        return `Window ${account.assigned_window_number} is already assigned to another queue window staff account.`;
      }
      usedAssignedWindowNumbers.add(account.assigned_window_number);

      if (account.service_window === 'OTHER') {
        if (![4, 5].includes(account.assigned_window_number)) {
          return 'Other queue windows are only available for Window 4 and Window 5.';
        }
        if (!account.custom_label) {
          return `Please enter a name for Window ${account.assigned_window_number}.`;
        }
        if (RESERVED_CUSTOM_WINDOW_LABELS.has(normalizeCustomWindowLabelKey(account.custom_label))) {
          return `Window ${account.assigned_window_number} custom name cannot be "${account.custom_label}". Please use a unique custom transaction name instead of RPT, BT, or MISC.`;
        }
        continue;
      }

      if (usedServiceWindows.has(account.service_window)) {
        const label = SERVICE_WINDOW_CHOICES.find((choice) => choice.key === account.service_window)?.label || account.service_window;
        return `${label} is already assigned to another window.`;
      }
      usedServiceWindows.add(account.service_window);
    }
    return '';
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  const fetchBranches = async () => {
    try {
      const response = await api.get('/branches/');
      setBranches(response.data);
      setPageError('');
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch branches:', error);
      setPageError(error.response?.data?.detail || 'Failed to load branches.');
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const nextValue = name === 'counters' ? getNormalizedCounterCount(value) : value;
    setFormData((previous) => ({
      ...previous,
      [name]: nextValue,
      dashboard_url: name === 'name' ? buildBranchDashboardUrl(nextValue) : previous.dashboard_url,
    }));
    if (name === 'admin_email') {
      setAdminEmailError(getEmailValidationMessage(nextValue));
    }
    if (modalError) {
      setModalError('');
    }
  };

  const handlePresetChange = (e) => {
    const presetId = e.target.value;
    setSelectedPreset(presetId);
    setMapPickerError('');

    if (presetId === 'custom') {
      setFormData((previous) => ({
        ...previous,
        name: '',
        location: '',
        contact: '',
        dashboard_url: buildBranchDashboardUrl('branch'),
      }));
      setSelectedMapLocation(null);
      setMapSearchResults([]);
      setMapSearchQuery('');
      setShowMapPickerModal(true);
      return;
    }

    const preset = BRANCH_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    setFormData((previous) => ({
      ...previous,
      name: preset.name,
      location: preset.location,
      contact: preset.contact,
      dashboard_url: buildBranchDashboardUrl(preset.name),
    }));
  };

  const handleAddBranch = () => {
    setEditingBranch(null);
    setSelectedPreset(DEFAULT_PRESET_ID);
    setFormData(EMPTY_BRANCH_FORM);
    setModalError('');
    setAdminEmailError('');
    setWindowAccounts(EMPTY_WINDOW_ACCOUNTS);
    setSuccessMessage('');
    setPendingNotice('');
    setSelectedMapLocation(null);
    setMapPickerError('');
    setMapSearchQuery('');
    setMapSearchResults([]);
    setShowMapPickerModal(false);
    setShowModal(true);
  };

  const handleEditBranch = (branch) => {
    setEditingBranch(branch);
    setSelectedPreset('custom');
    setFormData({
      ...EMPTY_BRANCH_FORM,
      ...branch,
      dashboard_url: branch.dashboard_url || buildBranchDashboardUrl(branch.name || 'branch'),
      admin_password: '',
    });
    setModalError('');
    setAdminEmailError('');
    setWindowAccounts(buildWindowAccountsState(branch.window_accounts || []));
    setSuccessMessage('');
    setPendingNotice('');
    setSelectedMapLocation(null);
    setMapPickerError('');
    setMapSearchQuery('');
    setMapSearchResults([]);
    setShowModal(true);
  };

  const handleManageBranch = async (branch) => {
    try {
      setPageError('');
      const response = await api.post(`/branches/${branch.id}/superadmin-access`);
      localStorage.setItem('branchToken', response.data.access_token);
      localStorage.setItem('branchUser', JSON.stringify(response.data.user));
      localStorage.setItem('branchAuthenticatedAt', new Date().toISOString());
      window.location.href = response.data.user?.dashboard_url || buildBranchDashboardUrl(branch.name || 'branch');
    } catch (error) {
      setPageError(error.response?.data?.detail || 'Unable to open this branch dashboard as Superadmin.');
    }
  };

  const openLocationMapPicker = () => {
    if (!editingBranch && selectedPreset !== 'custom') {
      setSelectedPreset('custom');
    }
    setShowMapPickerModal(true);
  };

  const handleSaveBranch = async () => {
    if (!formData.name || !formData.location || !formData.contact) {
      setModalError('Please fill in all required fields.');
      return;
    }

    if (!editingBranch && selectedPreset === 'custom' && !selectedMapLocation) {
      setModalError('Please choose the custom branch location from the map before saving.');
      return;
    }

    const normalizedBranchName = formData.name.trim();
    const duplicateBranch = branches.find(
      (branch) =>
        branch.name.trim().toLowerCase() === normalizedBranchName.toLowerCase()
        && branch.id !== editingBranch?.id
    );
    if (duplicateBranch) {
      setModalError('This branch name has already been used.');
      return;
    }

    // For new branches, require admin account details
    if (!editingBranch) {
      if (!formData.admin_username || !formData.admin_email || !formData.admin_password) {
        setModalError('Please fill in admin account details for the new branch.');
        return;
      }

      const nextAdminEmailError = getEmailValidationMessage(formData.admin_email);
      if (nextAdminEmailError) {
        setAdminEmailError(nextAdminEmailError);
        setModalError('Please correct the highlighted admin email field.');
        return;
      }

      const passwordError = validateStrongPassword(formData.admin_password);
      if (passwordError) {
        setModalError(passwordError);
        return;
      }

    }

    setLoading(true);
    setModalError('');
    setPageError('');
    setSuccessMessage('');
    setPendingNotice('');
    try {
      let response;
      if (editingBranch) {
        const editWindowAccounts = buildWindowAccountPayload(getNormalizedCounterCount(formData.counters));
        const windowValidationError = validateWindowAccountPayload(editWindowAccounts);
        if (windowValidationError) {
          setModalError(windowValidationError);
          setLoading(false);
          return;
        }
        setPendingBranchSave({
          branchId: editingBranch.id,
          payload: {
            name: formData.name,
            location: formData.location,
            contact: formData.contact,
            counters: formData.counters,
            status: formData.status,
            window_accounts: editWindowAccounts,
          },
        });
        setAuthModalError('');
        setAuthModal({
          mode: 'edit',
          branchId: editingBranch.id,
          branchName: formData.name,
          password: '',
        });
        setLoading(false);
        return;
      } else {
        // Create branch with admin account
        const { dashboard_url, ...createPayload } = formData;
        createPayload.counters = getNormalizedCounterCount(createPayload.counters);
        createPayload.window_accounts = buildWindowAccountPayload(createPayload.counters);
        const windowValidationError = validateWindowAccountPayload(createPayload.window_accounts);
        if (windowValidationError) {
          setModalError(windowValidationError);
          setLoading(false);
          return;
        }
        response = await api.post('/branches/', createPayload);
      }
      await fetchBranches();
      window.dispatchEvent(new Event('wards-accounts-refresh'));
      setShowModal(false);
      setSelectedPreset(DEFAULT_PRESET_ID);
      setFormData(EMPTY_BRANCH_FORM);
      setWindowAccounts(EMPTY_WINDOW_ACCOUNTS);
      if (!editingBranch && response?.data?.requires_admin_email_verification) {
        const deliveryMessage = response?.data?.email_delivery?.message || 'Verification email sent to the branch admin address.';
        const windowAccountCount = response?.data?.window_accounts_created?.length || 0;
        const windowMessage = windowAccountCount > 0
          ? ` ${windowAccountCount} queue window account${windowAccountCount > 1 ? 's were' : ' was'} also generated automatically, included in the branch admin verification email with login email addresses and temporary passwords, and set with Microsoft Authenticator MFA required on first login.`
          : '';
        setPendingNotice(`${deliveryMessage} Branch admin access will remain pending until the recipient verifies the email.${windowMessage}`);
      } else if (!editingBranch && response?.data?.email_delivery?.message) {
        setSuccessMessage(response.data.email_delivery.message);
      } else {
        setSuccessMessage(editingBranch ? 'Branch updated successfully.' : 'Branch created successfully.');
      }
    } catch (error) {
      console.error('Failed to save branch:', error);
      setModalError(error.response?.data?.detail || 'Failed to save branch.');
    } finally {
      setLoading(false);
    }
  };

  const syncMapSelectionToForm = (selection) => {
    setSelectedMapLocation(selection);
    setFormData((previous) => ({
      ...previous,
      location: selection.address,
    }));
    setMapPickerError('');
  };

  const placeMapMarker = (lng, lat) => {
    const map = mapInstanceRef.current;
    const maplibregl = window.maplibregl;
    if (!map || !maplibregl) {
      return;
    }
    if (!mapMarkerRef.current) {
      mapMarkerRef.current = new maplibregl.Marker({ color: '#1d4ed8' });
    }
    mapMarkerRef.current.setLngLat([lng, lat]).addTo(map);
  };

  const reverseGeocodeLocation = async (lng, lat) => {
    const data = await fetchMapTilerJson(
      `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${MAPTILER_API_KEY}`
    );
    const feature = data?.features?.[0];
    if (!feature) {
      throw new Error('No address details were found for the selected map point.');
    }
    const address = feature.place_name || feature.place_name_en || feature.text || `${lat}, ${lng}`;
    syncMapSelectionToForm({
      lng,
      lat,
      address,
    });
  };

  const handleMapSearch = async () => {
    if (!mapSearchQuery.trim()) {
      setMapSearchResults([]);
      return;
    }

    try {
      setMapPickerLoading(true);
      setMapPickerError('');
      const data = await fetchMapTilerJson(
        `https://api.maptiler.com/geocoding/${encodeURIComponent(mapSearchQuery.trim())}.json?key=${MAPTILER_API_KEY}&limit=5&country=ph`
      );
      setMapSearchResults(data?.features || []);
      if (!data?.features?.length) {
        setMapPickerError('No matching map locations were found.');
      }
    } catch (error) {
      setMapPickerError(error.message || 'Failed to search the map.');
    } finally {
      setMapPickerLoading(false);
    }
  };

  const handleSelectSearchResult = (feature) => {
    const [lng, lat] = feature.center || [];
    if (typeof lng !== 'number' || typeof lat !== 'number' || !mapInstanceRef.current) {
      setMapPickerError('This map result could not be selected.');
      return;
    }

    placeMapMarker(lng, lat);
    mapInstanceRef.current.flyTo({ center: [lng, lat], zoom: 15 });
    syncMapSelectionToForm({
      lng,
      lat,
      address: feature.place_name || feature.place_name_en || feature.text || formData.location,
    });
  };

  useEffect(() => {
    if (!showMapPickerModal || !mapContainerRef.current) {
      return;
    }

    let disposed = false;

    const initializeMap = async () => {
      try {
        setMapPickerLoading(true);
        setMapPickerError('');
        const maplibregl = await loadMapLibreAssets();
        if (disposed || mapInstanceRef.current || !mapContainerRef.current) {
          return;
        }

        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: MAPTILER_STYLE_URL,
          center: [selectedMapLocation?.lng || DEFAULT_MAP_CENTER.lng, selectedMapLocation?.lat || DEFAULT_MAP_CENTER.lat],
          zoom: selectedMapLocation ? 15 : 11,
        });

        map.addControl(new maplibregl.NavigationControl(), 'top-right');
        map.on('click', async (event) => {
          try {
            setMapPickerError('');
            const { lng, lat } = event.lngLat;
            placeMapMarker(lng, lat);
            await reverseGeocodeLocation(lng, lat);
          } catch (error) {
            setMapPickerError(error.message || 'Failed to read the selected map location.');
          }
        });

        mapInstanceRef.current = map;

        if (selectedMapLocation) {
          placeMapMarker(selectedMapLocation.lng, selectedMapLocation.lat);
        }
      } catch (error) {
        setMapPickerError(error.message || 'Failed to load the map picker.');
      } finally {
        if (!disposed) {
          setMapPickerLoading(false);
        }
      }
    };

    initializeMap();

    return () => {
      disposed = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      mapMarkerRef.current = null;
    };
  }, [showMapPickerModal]);

  const handleDeleteBranch = async (id, name) => {
    setPageError('');
    setSuccessMessage('');
    setPendingNotice('');
    setAuthModalError('');
    setAuthModal({
      mode: 'delete',
      branchId: id,
      branchName: name,
      password: '',
    });
  };

  const closeAuthModal = () => {
    setAuthModalError('');
    setAuthModal(EMPTY_AUTH_MODAL);
    setPendingBranchSave(null);
  };

  const handleConfirmProtectedAction = async () => {
    if (!authModal.password) {
      setAuthModalError(`Please enter your ${verifierLabelLower} password to continue.`);
      return;
    }

    try {
      setIsProtectedActionLoading(true);
      setPageError('');
      setSuccessMessage('');
      setPendingNotice('');
      setAuthModalError('');

      if (authModal.mode === 'edit' && pendingBranchSave) {
        await api.put(`/branches/${pendingBranchSave.branchId}`, {
          ...pendingBranchSave.payload,
          current_admin_password: authModal.password,
        });
        await fetchBranches();
        window.dispatchEvent(new Event('wards-accounts-refresh'));
        setShowModal(false);
        setSelectedPreset('custom');
        setFormData(EMPTY_BRANCH_FORM);
        setWindowAccounts(EMPTY_WINDOW_ACCOUNTS);
        setSuccessMessage('Branch updated successfully.');
      }

      if (authModal.mode === 'delete' && authModal.branchId) {
        await api.delete(`/branches/${authModal.branchId}`, {
          data: {
            current_admin_password: authModal.password,
          },
        });
        await fetchBranches();
        window.dispatchEvent(new Event('wards-accounts-refresh'));
        setSuccessMessage('Branch deleted successfully.');
      }

      closeAuthModal();
    } catch (error) {
      console.error('Failed to complete protected branch action:', error);
      const errorDetail = error.response?.data?.detail || 'Failed to complete branch action.';
      if (errorDetail.toLowerCase().includes('incorrect') && errorDetail.toLowerCase().includes('password')) {
        setAuthModalError('Incorrect password. Please try again.');
        setPageError('');
      } else {
        setAuthModalError('');
        setPageError(errorDetail);
      }
    } finally {
      setIsProtectedActionLoading(false);
    }
  };

  const handleResendVerification = async (branch) => {
    try {
      setPageError('');
      setSuccessMessage('');
      setPendingNotice('');
      const response = await api.post(`/branches/${branch.id}/resend-verification`);
      setPendingNotice(response.data.message);
      await fetchBranches();
    } catch (error) {
      console.error('Failed to resend branch verification:', error);
      setPageError(error.response?.data?.detail || 'Failed to resend verification email.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="border-4 border-primary border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin"></div>
          <p className="text-gray-600">Loading branches...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WardsPageHero
        eyebrow="Main Admin Dashboard"
        title="Manage Branches"
        subtitle="Oversee branch records, assign administrators, and maintain branch operational details from one place."
        actions={(
          <button 
            onClick={handleAddBranch}
            className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-semibold transition duration-300 shadow-lg"
          >
            + Add New Branch
          </button>
        )}
      />

      {pageError && (
        <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
          <p className="font-semibold">{pageError}</p>
        </div>
      )}

      {successMessage && (
        <div className="mb-6 bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded">
          <p className="font-semibold">{successMessage}</p>
        </div>
      )}

      {pendingNotice && (
        <div className="mb-6 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded">
          <p className="font-semibold">{pendingNotice}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {branches.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <p className="text-gray-500 text-lg">No branches found. Click "+ Add New Branch" to create one.</p>
          </div>
        ) : (
          branches.map((branch) => (
          <div key={branch.id} className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition duration-300">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-bold text-primary">{branch.name}</h3>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                branch.verification_status === 'Pending'
                  ? 'bg-yellow-100 text-yellow-800'
                  : branch.verification_status === 'Active'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
              }`}>
                {branch.verification_status || branch.status}
              </span>
            </div>
            <div className="space-y-2 mb-4">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-gray-500 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
                <span className="text-gray-600 text-sm">{branch.location}</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-gray-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
                </svg>
                <span className="text-gray-600 text-sm">{branch.contact}</span>
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-gray-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"></path>
                </svg>
                <span className="text-gray-600 text-sm">{branch.counters} Service Counters</span>
              </div>
              {branch.dashboard_url && (
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-gray-500 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 010 5.656l-4 4a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l4-4a4 4 0 115.656 5.656l-1.5 1.5"></path>
                  </svg>
                  <span className="text-gray-600 text-sm break-all">{branch.dashboard_url}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {branch.verification_status === 'Pending' && (
                <button
                  onClick={() => handleResendVerification(branch)}
                  className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white py-2 rounded-lg font-semibold transition duration-300"
                >
                  Resend Verification
                </button>
              )}
              {isSuperadmin && (
                <button
                  onClick={() => handleManageBranch(branch)}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-lg font-semibold transition duration-300"
                >
                  Manage
                </button>
              )}
              <button 
                onClick={() => handleEditBranch(branch)}
                className="flex-1 bg-accent hover:bg-blue-600 text-white py-2 rounded-lg font-semibold transition duration-300"
              >
                Edit
              </button>
              <button 
                  onClick={() => handleDeleteBranch(branch.id, branch.name)}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg font-semibold transition duration-300"
                >
                  Delete
              </button>
            </div>
          </div>
        ))
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-8 shadow-2xl">
            <h3 className="text-2xl font-bold text-primary mb-6">
              {editingBranch ? 'Edit Branch' : 'Add New Branch'}
            </h3>
            {modalError && (
              <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded">
                <p className="font-semibold">{modalError}</p>
              </div>
            )}
            <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
              {!editingBranch && (
                <div className="md:col-span-2">
                  <label className="block text-gray-700 font-semibold mb-2">Predefined Branch Office</label>
                  <select
                    value={selectedPreset}
                    onChange={handlePresetChange}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                  >
                    <option value="custom">Other / Custom Branch</option>
                    {BRANCH_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name} - {preset.location}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-sm text-gray-500">
                    Choose an official branch office to auto-fill the branch name, location, and contact details.
                  </p>
                </div>
              )}

              <div>
                <div className="mb-2 flex min-h-10 items-center">
                  <label className="block text-gray-700 font-semibold">Branch Name</label>
                </div>
                <input 
                  type="text" 
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  maxLength={255}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                />
              </div>
              <div>
                <div className="mb-2 flex min-h-10 items-center justify-between gap-3">
                  <label className="block font-semibold text-gray-700">Location</label>
                  {!editingBranch && (
                    <button
                      type="button"
                      onClick={openLocationMapPicker}
                      className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition duration-300 hover:bg-blue-600"
                      title="Pick branch location from map"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke="currentColor" strokeWidth="2" />
                      </svg>
                      Pick from Map
                    </button>
                  )}
                </div>
                <input 
                  type="text" 
                  name="location"
                  value={formData.location}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                />
                {!editingBranch && (
                  <p className="mt-2 text-sm text-gray-500">
                    Choose a location from the map to auto-fill the branch address.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Contact</label>
                <input 
                  type="text" 
                  name="contact"
                  value={formData.contact}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-gray-700 font-semibold mb-2">Branch Dashboard Localhost URL</label>
                <input 
                  type="text" 
                  name="dashboard_url"
                  value={formData.dashboard_url}
                  readOnly
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                />
                <p className="mt-2 text-sm text-gray-500">
                  This route is generated automatically from the branch name and will be used in the branch access email.
                </p>
              </div>
              <div>
                <label className="block text-gray-700 font-semibold mb-2">Service Counters</label>
                <input 
                  type="number" 
                  name="counters"
                  value={formData.counters}
                  onChange={handleInputChange}
                  min="1"
                  max={MAX_QUEUE_WINDOWS}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                />
                {!editingBranch && (
                  <p className="mt-2 text-sm text-gray-500">
                    This count automatically defines the same number of queue-only branch staff accounts.
                  </p>
                )}
              </div>
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
              {(
                <>
                  {!editingBranch && (
                    <>
                      <div className="md:col-span-2 mt-2 border-t pt-5">
                        <h4 className="text-lg font-bold text-gray-700 mb-3">Branch Admin Account</h4>
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          Branch admin access stays in <span className="font-semibold">Pending Verification</span> until the recipient verifies the email from the branch access message.
                        </div>
                      </div>
                      <div>
                        <label className="block text-gray-700 font-semibold mb-2">Admin Username</label>
                        <input 
                          type="text" 
                          name="admin_username"
                          value={formData.admin_username}
                          onChange={handleInputChange}
                          placeholder="e.g., galas_admin"
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                          required={!editingBranch}
                        />
                      </div>
                      <div>
                        <label className="block text-gray-700 font-semibold mb-2">Admin Email</label>
                        <input 
                          type="email" 
                          name="admin_email"
                          value={formData.admin_email}
                          onChange={handleInputChange}
                          placeholder="admin@branch.gov"
                          pattern="^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
                          className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent ${
                            adminEmailError ? 'border-red-500 bg-red-50' : 'border-gray-300'
                          }`}
                          required={!editingBranch}
                        />
                        {adminEmailError ? (
                          <p className="mt-2 text-sm font-semibold text-red-600">{adminEmailError}</p>
                        ) : null}
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-gray-700 font-semibold mb-2">Admin Password</label>
                        <PasswordField
                          name="admin_password"
                          value={formData.admin_password}
                          onChange={handleInputChange}
                          placeholder="More than 12 chars with uppercase, lowercase, and number or special char"
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                          required={!editingBranch}
                        />
                        <p className="mt-2 text-sm text-gray-500">
                          Password must be more than 12 characters with uppercase, lowercase, and a number or special character.
                        </p>
                      </div>
                    </>
                  )}
                  <div className="md:col-span-2 mt-2 border-t pt-5">
                    <h4 className="text-lg font-bold text-gray-700 mb-3">Service Counters / Queue Window Staff Accounts</h4>
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                      {editingBranch
                        ? `Reassign each queue-only branch staff account to the correct physical window and transaction type here. Saving updates the connected window assignment, branch login behavior, and live queue routing so the existing credentials continue pointing to the correct window setup.`
                        : `Service counters and queue window staff accounts are the same setup here. If you set ${getNormalizedCounterCount(formData.counters)} service counter${getNormalizedCounterCount(formData.counters) > 1 ? 's' : ''}, the system will generate ${getNormalizedCounterCount(formData.counters)} queue-only branch staff account${getNormalizedCounterCount(formData.counters) > 1 ? 's' : ''}. The system automatically generates the login email addresses, passwords, and staff names, then includes those credentials in the same branch admin email verification message. Every generated queue account uses Microsoft Authenticator MFA on first login.`}
                    </div>
                  </div>
                  {getActiveWindowOptions().map((option, index) => {
                    const selectedServiceWindow = getSelectedServiceWindow(option.key);
                    const selectedAssignedWindowNumber = getSelectedAssignedWindowNumber(option.key, option.number);
                    const serviceChoices = selectedAssignedWindowNumber >= 4
                      ? [...SERVICE_WINDOW_CHOICES, { key: 'OTHER', label: 'Other' }]
                      : SERVICE_WINDOW_CHOICES;
                    return (
                      <div key={option.key} className="md:col-span-2 rounded-xl border border-slate-200 p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                              {option.number}
                            </div>
                            <span>
                              <span className="block text-base font-semibold text-slate-800">{option.label}</span>
                              <span className="mt-1 block text-sm text-slate-500">{option.description}</span>
                            </span>
                          </div>
                          <div className="grid w-full gap-4 lg:w-[32rem] lg:grid-cols-2">
                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700">Assigned Window</label>
                              <select
                                value={selectedAssignedWindowNumber}
                                onChange={(event) => handleWindowAccountChange(option.key, 'assigned_window_number', Number(event.target.value))}
                                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 focus:border-transparent focus:ring-2 focus:ring-accent"
                              >
                                {getActiveWindowOptions().map((windowOption) => (
                                  <option
                                    key={windowOption.number}
                                    value={windowOption.number}
                                    disabled={isAssignedWindowNumberUnavailable(option.key, windowOption.number)}
                                  >
                                    Window {windowOption.number}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700">Assigned Service</label>
                              <select
                                value={selectedServiceWindow}
                                onChange={(event) => handleWindowAccountChange(option.key, 'service_window', event.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 focus:border-transparent focus:ring-2 focus:ring-accent"
                              >
                                {serviceChoices.map((choice) => (
                                  <option
                                    key={choice.key}
                                    value={choice.key}
                                    disabled={isServiceChoiceUnavailable(option.key, choice.key)}
                                  >
                                    {choice.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {selectedServiceWindow === 'OTHER' ? (
                              <input
                                type="text"
                                value={windowAccounts[option.key]?.custom_label || ''}
                                onChange={(event) => handleWindowAccountChange(option.key, 'custom_label', event.target.value)}
                                placeholder={`Window ${selectedAssignedWindowNumber} service name`}
                                maxLength={80}
                                className="lg:col-span-2 w-full rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-800 focus:border-transparent focus:ring-2 focus:ring-accent"
                              />
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                          {editingBranch
                            ? `Saving will update this staff account to Window ${selectedAssignedWindowNumber} with ${selectedServiceWindow === 'OTHER' ? (windowAccounts[option.key]?.custom_label || 'custom service') : (SERVICE_WINDOW_CHOICES.find((choice) => choice.key === selectedServiceWindow)?.label || selectedServiceWindow)} routing while keeping connected branch logic in sync.`
                            : `Login email address, temporary password, staff full name, queue-only access scope, Microsoft Authenticator MFA setup, and the voice announcement route to ${option.label} will be generated automatically.`}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
            <div className="flex gap-4 mt-6">
              <button 
                onClick={() => {
                  setShowModal(false);
                  setSelectedPreset(DEFAULT_PRESET_ID);
                  setWindowAccounts(EMPTY_WINDOW_ACCOUNTS);
                  setShowMapPickerModal(false);
                }}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-semibold transition duration-300"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveBranch}
                disabled={loading}
                className="flex-1 bg-primary hover:bg-secondary text-white py-3 rounded-lg font-semibold transition duration-300 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && showMapPickerModal && !editingBranch && selectedPreset === 'custom' && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-60 p-4">
          <div className="w-full max-w-5xl rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-2xl font-bold text-primary">Choose Custom Branch Location</h4>
                <p className="mt-2 text-sm text-gray-600">
                  Search or click on the map. The selected address will be copied into the branch location field.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMapPickerModal(false)}
                className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition duration-300 hover:bg-gray-300"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-gray-700">Search Address</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={mapSearchQuery}
                      onChange={(event) => setMapSearchQuery(event.target.value)}
                      placeholder="Search Quezon City address"
                      className="flex-1 rounded-lg border border-gray-300 px-4 py-3 focus:border-transparent focus:ring-2 focus:ring-accent"
                    />
                    <button
                      type="button"
                      onClick={handleMapSearch}
                      disabled={mapPickerLoading}
                      className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white transition duration-300 hover:bg-secondary disabled:opacity-50"
                    >
                      Search
                    </button>
                  </div>
                </div>

                {mapPickerError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {mapPickerError}
                  </div>
                )}

                <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {mapSearchResults.length === 0 ? (
                    <p className="text-sm text-slate-500">Search results will appear here.</p>
                  ) : (
                    mapSearchResults.map((feature) => (
                      <button
                        key={feature.id}
                        type="button"
                        onClick={() => handleSelectSearchResult(feature)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition duration-300 hover:border-accent hover:bg-blue-50"
                      >
                        <p className="font-semibold text-slate-800">{feature.text || 'Selected location'}</p>
                        <p className="mt-1 text-sm text-slate-500">{feature.place_name || feature.place_name_en}</p>
                      </button>
                    ))
                  )}
                </div>

                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-sm font-semibold text-emerald-900">Selected Address</p>
                  <p className="mt-2 text-sm text-emerald-800">
                    {selectedMapLocation?.address || 'No custom branch location selected yet.'}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div ref={mapContainerRef} className="h-[480px] w-full bg-slate-100" />
                </div>
                <p className="text-sm text-gray-500">
                  Click on the map to reverse-geocode an address, or use search to jump to a location and select it.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {authModal.mode && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4">
            <h3 className="text-2xl font-bold text-primary mb-3">
              {authModal.mode === 'edit' ? 'Verify Branch Edit' : 'Verify Branch Deletion'}
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              Enter your {verifierLabelLower} password to {authModal.mode} the branch
              {authModal.branchName ? ` "${authModal.branchName}"` : ''}.
            </p>
            {authModalError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {authModalError}
              </div>
            )}
            <div>
              <label className="block text-gray-700 font-semibold mb-2">{verifierLabel} Password</label>
              <PasswordField
                value={authModal.password}
                onChange={(e) => {
                  if (authModalError) {
                    setAuthModalError('');
                  }
                  setAuthModal((previous) => ({ ...previous, password: e.target.value }));
                }}
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
                disabled={isProtectedActionLoading}
                className="flex-1 bg-primary hover:bg-secondary text-white py-3 rounded-lg font-semibold transition duration-300 disabled:opacity-50"
              >
                {isProtectedActionLoading ? 'Verifying...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Branches;
