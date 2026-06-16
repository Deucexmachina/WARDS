import api from '../../services/api';
import { useEffect, useMemo, useState } from 'react';
import { CustomSelect } from '../../components/FormControls';
import { useSearchParams } from 'react-router-dom';
import { taxpayerAccountAPI, queueAPI, unifiedAuthAPI } from '../../services/api';
import { getStoredPublicUser, setStoredPublicUser } from '../../utils/publicSession';
import { usePublicLanguage } from '../../utils/publicLanguage';
import {
  getEmailValidationMessage,
  normalizePhilippineContactDigits,
  validatePhilippineContactDigits,
  validateStrongPassword,
  validateCitizenFullName,
  normalizeCitizenFullName,
} from '../../utils/validation';

const DEFAULT_PROFILE = {
  full_name: '',
  email: '',
  mobile_number: '',
  address: '',
  taxpayer_type: 'Individual',
};

const DEFAULT_IDENTIFIER_FORM = {
  submission_type: 'RPT',
  taxpayer_type: 'Individual',
  tdn: '',
  mayor_permit_number: '',
  sec_dti_cda_number: '',
  supporting_file: null,
};

const DEFAULT_PASSWORD_FORM = {
  current_password: '',
  new_password: '',
  confirm_new_password: '',
};

const statusTone = {
  'Pending Verification': 'bg-amber-100 text-amber-800 border-amber-200',
  Verified: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Rejected: 'bg-rose-100 text-rose-800 border-rose-200',
  Active: 'bg-blue-100 text-blue-800 border-blue-200',
  Inactive: 'bg-slate-100 text-slate-700 border-slate-200',
  Pending: 'bg-amber-100 text-amber-800 border-amber-200',
  Waiting: 'bg-sky-100 text-sky-800 border-sky-200',
  Called: 'bg-violet-100 text-violet-800 border-violet-200',
  Serving: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  Completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Cancelled: 'bg-rose-100 text-rose-800 border-rose-200',
  Expired: 'bg-slate-100 text-slate-700 border-slate-200',
  Missed: 'bg-orange-100 text-orange-800 border-orange-200',
  'No Show': 'bg-orange-100 text-orange-800 border-orange-200',
};

const formatCurrency = (value) =>
  `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatTimestamp = (value) =>
  value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A';

const buildStoredPublicProfile = (profile) => ({
  id: profile?.id,
  email: profile?.email || '',
  full_name: profile?.full_name || '',
  contact_number: profile?.mobile_number || '',
  address: profile?.address || '',
  taxpayer_type: profile?.taxpayer_type || 'Individual',
});

const isProfileReady = (profile) =>
  Boolean(
    profile?.full_name?.trim() &&
    profile?.email?.trim() &&
    profile?.mobile_number?.trim() &&
    profile?.address?.trim() &&
    profile?.taxpayer_type?.trim()
  );

const AccountManagement = () => {
  const [searchParams] = useSearchParams();
  const [language] = usePublicLanguage();
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [originalProfile, setOriginalProfile] = useState(DEFAULT_PROFILE);
  const [identifierForm, setIdentifierForm] = useState(DEFAULT_IDENTIFIER_FORM);
  const [submissions, setSubmissions] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [queueHistory, setQueueHistory] = useState([]);
  const [isProfileLocked, setIsProfileLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [submittingIdentifier, setSubmittingIdentifier] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [contactError, setContactError] = useState('');
  const [contactCheckingUniqueness, setContactCheckingUniqueness] = useState(false);
  const [fullNameError, setFullNameError] = useState('');
  const [addressError, setAddressError] = useState('');
  const [identifierErrors, setIdentifierErrors] = useState({});
  const [currentPasswordError, setCurrentPasswordError] = useState('');
  const [newPasswordError, setNewPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [confirmProfilePassword, setConfirmProfilePassword] = useState('');
  const [showProfileConfirm, setShowProfileConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState(DEFAULT_PASSWORD_FORM);
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  const [mfaSetupLang, setMfaSetupLang] = useState(language);
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [mfaTotpCode, setMfaTotpCode] = useState('');
  const [mfaTotpError, setMfaTotpError] = useState('');
  const [mfaPassword, setMfaPassword] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaMessage, setMfaMessage] = useState('');
  const [mfaError, setMfaError] = useState('');

  const loadAccount = async () => {
    try {
      setLoading(true);
      const response = await taxpayerAccountAPI.getAccount();
      const nextProfile = response.data?.profile || DEFAULT_PROFILE;
      setProfile({
        ...DEFAULT_PROFILE,
        ...nextProfile,
        mobile_number: normalizePhilippineContactDigits(nextProfile.mobile_number || ''),
      });
      setOriginalProfile({
        ...DEFAULT_PROFILE,
        ...nextProfile,
        mobile_number: normalizePhilippineContactDigits(nextProfile.mobile_number || ''),
      });
      setStoredPublicUser(buildStoredPublicProfile(nextProfile));
      setIsProfileLocked(isProfileReady(nextProfile));
      setIdentifierForm((current) => ({
        ...current,
        taxpayer_type: nextProfile.taxpayer_type || 'Individual',
      }));
      setSubmissions(response.data?.submissions || []);
      setAssessments(response.data?.assessments || []);
      setMfaEnabled(Boolean(response.data?.mfa_enabled));

      // Load queue history
      try {
        const queueResponse = await queueAPI.getMyHistory();
        setQueueHistory(queueResponse.data?.history || []);
      } catch (queueError) {
        console.error('Failed to load queue history:', queueError);
        setQueueHistory([]);
      }
      
      setError('');
    } catch (fetchError) {
      setError(fetchError.response?.data?.detail || 'Failed to load taxpayer account management data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccount();
  }, []);

  useEffect(() => {
    if (mfaEnabled) return;
    const autoOpen = searchParams.get('mfaSetup') === '1';
    if (autoOpen) {
      setShowMfaSetup(true);
      setMfaError('');
      setMfaMessage('');
      setMfaPassword('');
      setMfaTotpCode('');
      setMfaTotpError('');
    }
  }, [mfaEnabled, searchParams]);

  useEffect(() => {
    if (showMfaSetup) {
      setMfaSetupLang(language);
    }
  }, [showMfaSetup, language]);

  const handleStartMfaSetup = async () => {
    setShowMfaSetup(true);
    setMfaError('');
    setMfaMessage('');
    setMfaPassword('');
    setMfaTotpCode('');
    setMfaTotpError('');
  };

  const handleRequestMfaSetup = async () => {
    if (!mfaPassword) {
      setMfaError(
        language === 'en'
          ? 'Please enter your current password to continue.'
          : 'Mangyaring ilagay ang iyong kasalukuyang password para magpatuloy.'
      );
      return;
    }
    try {
      setMfaLoading(true);
      setMfaError('');
      const response = await unifiedAuthAPI.setupMfa({
        identifier: profile.email,
        password: mfaPassword,
      });
      setMfaSetupData(response.data);
      setMfaMessage('');
    } catch (err) {
      setMfaError(
        err.response?.data?.detail ||
        (language === 'en' ? 'Failed to start MFA setup.' : 'Nabigo ang pagumpisa ng MFA setup.')
      );
    } finally {
      setMfaLoading(false);
    }
  };

  const handleVerifyMfaSetup = async () => {
    if (!mfaTotpCode || mfaTotpCode.length !== 6) {
      setMfaTotpError(
        language === 'en'
          ? 'Please enter the 6-digit code from your authenticator app.'
          : 'Mangyaring ilagay ang 6-digit code mula sa iyong authenticator app.'
      );
      return;
    }
    try {
      setMfaLoading(true);
      setMfaError('');
      setMfaTotpError('');
      await unifiedAuthAPI.verifyMfaSetup({
        identifier: profile.email,
        password: mfaPassword,
        totp_code: mfaTotpCode,
      });
      setMfaEnabled(true);
      setShowMfaSetup(false);
      setMfaSetupData(null);
      setMfaMessage(
        language === 'en'
          ? 'MFA enabled successfully. Future logins will require your authenticator code.'
          : 'Tagumpay na na-enable ang MFA. Kakailanganin ang iyong authenticator code sa susunod na login.'
      );
      setMfaPassword('');
      setMfaTotpCode('');
    } catch (err) {
      setMfaError(
        err.response?.data?.detail ||
        (language === 'en'
          ? 'Verification failed. Please check the code and try again.'
          : 'Nabigo ang verification. Mangyaring suriin ang code at subukang muli.')
      );
    } finally {
      setMfaLoading(false);
    }
  };

  const handleCancelMfaSetup = () => {
    setShowMfaSetup(false);
    setMfaSetupData(null);
    setMfaError('');
    setMfaMessage('');
    setMfaPassword('');
    setMfaTotpCode('');
    setMfaTotpError('');
  };

  const rptAssessments = useMemo(() => assessments.filter((item) => item.tax_type === 'RPT'), [assessments]);
  const btAssessments = useMemo(() => assessments.filter((item) => item.tax_type === 'BT'), [assessments]);

  const handleProfileChange = (event) => {
    const { name, value } = event.target;
    if (name === 'mobile_number') {
      const normalizedDigits = normalizePhilippineContactDigits(value);
      setProfile((current) => ({ ...current, mobile_number: normalizedDigits }));
      setContactError(validatePhilippineContactDigits(normalizedDigits));
      setMessage('');
      setError('');
      return;
    }

    setProfile((current) => ({ ...current, [name]: value }));
    if (name === 'email') {
      setEmailError(getEmailValidationMessage(value));
    }
    if (name === 'full_name') {
      const normalized = normalizeCitizenFullName(value);
      setFullNameError(validateCitizenFullName(normalized));
    }
    if (name === 'address') {
      setAddressError(String(value || '').trim() ? '' : 'Address is required.');
    }
    if (name === 'taxpayer_type') {
      setIdentifierForm((current) => ({ ...current, taxpayer_type: value }));
    }
    setMessage('');
    setError('');
  };

  const handleContactBlur = async () => {
    const digits = profile.mobile_number;
    const formatError = validatePhilippineContactDigits(digits);
    if (formatError) {
      return;
    }
    const storedUser = getStoredPublicUser();
    setContactCheckingUniqueness(true);
    try {
      const response = await api.post('/auth/unified/check-contact', {
        contact_number: `+63${digits}`,
        exclude_citizen_id: storedUser?.id ?? null,
      });
      if (!response.data.available) {
        setContactError('This contact number is unavailable. Please enter a different contact number.');
      }
    } catch {
      // silently skip — server-side will catch it on save
    } finally {
      setContactCheckingUniqueness(false);
    }
  };

  const handleIdentifierChange = (event) => {
    const { name, value, files } = event.target;
    setIdentifierForm((current) => ({
      ...current,
      [name]: name === 'supporting_file' ? files?.[0] || null : value,
      taxpayer_type: name === 'submission_type' && value === 'RPT' ? profile.taxpayer_type : current.taxpayer_type,
    }));
    setIdentifierErrors((current) => ({ ...current, [name]: '' }));
    if (name === 'submission_type') setIdentifierErrors({});
    setMessage('');
    setError('');
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    const nextEmailError = getEmailValidationMessage(profile.email);
    if (nextEmailError) {
      setEmailError(nextEmailError);
      setError('Correct the highlighted email field before saving.');
      return;
    }

    const nextContactError = validatePhilippineContactDigits(profile.mobile_number);
    if (nextContactError) {
      setContactError(nextContactError);
      setError('Correct the highlighted contact number field before saving.');
      return;
    }

    const nextFullNameError = validateCitizenFullName(profile.full_name);
    if (nextFullNameError) {
      setFullNameError(nextFullNameError);
      setError('Correct the highlighted full name field before saving.');
      return;
    }

    const nextAddressError = String(profile.address || '').trim() ? '' : 'Address is required.';
    if (nextAddressError) {
      setAddressError(nextAddressError);
      setError('Correct the highlighted address field before saving.');
      return;
    }

    setConfirmProfilePassword('');
    setError('');
    setShowProfileConfirm(true);
  };

  const handleConfirmSaveProfile = async (event) => {
    event.preventDefault();
    if (!confirmProfilePassword) {
      setError('Enter your current password to confirm profile changes.');
      return;
    }

    try {
      setSavingProfile(true);
      const response = await taxpayerAccountAPI.updateProfile({
        ...profile,
        current_password: confirmProfilePassword,
      });
      const nextProfile = response.data?.profile || profile;
      setProfile((current) => ({ ...current, ...nextProfile, mobile_number: normalizePhilippineContactDigits(nextProfile.mobile_number || current.mobile_number) }));
      setOriginalProfile((current) => ({ ...current, ...nextProfile, mobile_number: normalizePhilippineContactDigits(nextProfile.mobile_number || current.mobile_number) }));
      const currentStoredUser = getStoredPublicUser();
      setStoredPublicUser({
        ...(currentStoredUser || {}),
        ...buildStoredPublicProfile(nextProfile),
      });
      setMessage(response.data?.message || 'Profile updated successfully.');
      setError('');
      setIsProfileLocked(true);
      setShowProfileConfirm(false);
      setConfirmProfilePassword('');
      await loadAccount();
    } catch (saveError) {
      setError(saveError.response?.data?.detail || 'Failed to update taxpayer profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCancelEditProfile = () => {
    setProfile(originalProfile);
    setEmailError('');
    setContactError('');
    setFullNameError('');
    setAddressError('');
    setIsProfileLocked(true);
    setMessage('');
    setError('');
  };

  const handlePasswordFormChange = (event) => {
    const { name, value } = event.target;
    setPasswordForm((current) => ({ ...current, [name]: value }));
    setPasswordError('');
    if (name === 'current_password') setCurrentPasswordError('');
    if (name === 'new_password') setNewPasswordError('');
    if (name === 'confirm_new_password') setConfirmPasswordError('');
    setMessage('');
    setError('');
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    let hasError = false;
    if (!passwordForm.current_password) {
      setCurrentPasswordError('Current password is required.');
      hasError = true;
    }
    const nextNewPasswordError = passwordForm.new_password ? validateStrongPassword(passwordForm.new_password) : 'New password is required.';
    if (nextNewPasswordError) {
      setNewPasswordError(nextNewPasswordError);
      hasError = true;
    }
    if (!passwordForm.confirm_new_password) {
      setConfirmPasswordError('Please confirm your new password.');
      hasError = true;
    } else if (passwordForm.new_password !== passwordForm.confirm_new_password) {
      setConfirmPasswordError('New password and confirmation do not match.');
      hasError = true;
    }
    if (hasError) return;

    try {
      setChangingPassword(true);
      const response = await taxpayerAccountAPI.changePassword(passwordForm);
      setPasswordForm(DEFAULT_PASSWORD_FORM);
      setShowPasswordModal(false);
      setMessage(response.data?.message || 'Password changed successfully.');
      setError('');
    } catch (changeError) {
      setPasswordError(changeError.response?.data?.detail || 'Failed to change password.');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSubmitIdentifier = async (event) => {
    event.preventDefault();
    const nextIdentifierErrors = {};
    if (identifierForm.submission_type === 'RPT') {
      if (!String(identifierForm.tdn || '').trim()) nextIdentifierErrors.tdn = 'Tax Declaration Number is required.';
    } else {
      if (!String(identifierForm.mayor_permit_number || '').trim()) nextIdentifierErrors.mayor_permit_number = "Mayor's Permit Number is required.";
      if (!String(identifierForm.sec_dti_cda_number || '').trim()) nextIdentifierErrors.sec_dti_cda_number = 'SEC/DTI/CDA Registration Number is required.';
    }
    if (!identifierForm.supporting_file) nextIdentifierErrors.supporting_file = 'A supporting document is required.';
    if (Object.keys(nextIdentifierErrors).length) {
      setIdentifierErrors(nextIdentifierErrors);
      return;
    }

    const formData = new FormData();
    formData.append('submission_type', identifierForm.submission_type);
    formData.append('taxpayer_type', profile.taxpayer_type);
    formData.append('full_name', profile.full_name);
    formData.append('email', profile.email);
    formData.append('mobile_number', profile.mobile_number);
    formData.append('address', profile.address || '');
    if (identifierForm.tdn) formData.append('tdn', identifierForm.tdn);
    if (identifierForm.mayor_permit_number) formData.append('mayor_permit_number', identifierForm.mayor_permit_number);
    if (identifierForm.sec_dti_cda_number) formData.append('sec_dti_cda_number', identifierForm.sec_dti_cda_number);
    formData.append('supporting_file', identifierForm.supporting_file);

    try {
      setSubmittingIdentifier(true);
      const response = await taxpayerAccountAPI.submitIdentifier(formData);
      setIdentifierForm({
        ...DEFAULT_IDENTIFIER_FORM,
        taxpayer_type: profile.taxpayer_type,
      });
      setMessage(response.data?.message || 'Identifier submitted successfully.');
      setError('');
      await loadAccount();
    } catch (submitError) {
      setError(submitError.response?.data?.detail || 'Failed to submit taxpayer identifier.');
    } finally {
      setSubmittingIdentifier(false);
    }
  };

  const handleDownloadSubmission = async (submission) => {
    try {
      const response = await taxpayerAccountAPI.downloadSubmissionFile(submission.id);
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = submission.supporting_file_name || `submission-${submission.id}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      setError('Failed to download the supporting file.');
    }
  };

  const handleEditProfile = () => {
    setIsProfileLocked(false);
    setMessage('');
    setError('');
  };

  if (loading) {
    return (
      <section className="min-h-screen bg-[linear-gradient(180deg,#ecf3fb_0%,#f8fbff_100%)] py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-[32px] border border-slate-200 bg-white px-8 py-16 text-center shadow-[0_24px_50px_rgba(15,23,42,0.08)]">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[#0f5b83] border-t-transparent" />
            <p className="mt-4 text-sm text-slate-600">Loading taxpayer account management...</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[linear-gradient(180deg,#ecf3fb_0%,#f8fbff_100%)] py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[34px] border border-slate-200 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.10)]">
          <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#0f2f5f_0%,#174580_45%,#255f97_100%)] px-8 py-12 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blue-100">Public Taxpayer Account</p>
            <h1 className="mt-4 text-4xl font-bold sm:text-5xl">Account Management</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-blue-100">
              Maintain your taxpayer profile, submit official identifiers for verification, and track assessment records prepared by the Main Admin treasury team.
            </p>
          </div>

          <div className="px-8 py-10 sm:px-10">
            {(message || error) && (
              <div className={`mb-8 rounded-2xl border px-5 py-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                {error || message}
              </div>
            )}

            <div className="grid gap-8 xl:grid-cols-[1.1fr,0.9fr]">
              <form onSubmit={handleSaveProfile} className="rounded-[28px] border border-slate-200 bg-[#fbfdff] p-6 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Profile Management</p>
                    <h2 className="mt-2 text-2xl font-bold text-slate-900">Taxpayer Information</h2>
                  </div>
                  <button
                    type="button"
                    onClick={handleEditProfile}
                    disabled={savingProfile || !isProfileLocked}
                    className={`${isProfileLocked ? 'bg-[#0f5b83] hover:bg-[#0c4d6f]' : 'bg-slate-300'} rounded-full px-5 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    Edit Profile
                  </button>
                </div>

                {!isProfileLocked ? (
                  <div className="mb-6 flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      onClick={handleCancelEditProfile}
                      disabled={savingProfile}
                      className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingProfile || contactCheckingUniqueness}
                      className="rounded-full bg-[#0f5b83] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60"
                    >
                      {savingProfile ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                ) : null}

                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Full Name</span>
                    <input name="full_name" value={profile.full_name} onChange={handleProfileChange} disabled={isProfileLocked} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:ring-2 focus:ring-[#0f5b83]/10 ${fullNameError ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'}`} />
                    {fullNameError ? <span className="mt-2 block text-xs font-medium text-rose-600">{fullNameError}</span> : null}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Email Address</span>
                    <input name="email" type="email" value={profile.email} onChange={handleProfileChange} disabled={isProfileLocked} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:ring-2 focus:ring-[#0f5b83]/10 ${emailError ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'}`} />
                    {emailError ? <span className="mt-2 block text-xs font-medium text-rose-600">{emailError}</span> : null}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Contact Number</span>
                    <div className={`flex overflow-hidden rounded-2xl border ${contactError ? 'border-rose-400 bg-rose-50' : 'border-slate-300'} ${isProfileLocked ? 'bg-slate-100' : 'bg-white'}`}>
                      <span className="flex items-center bg-slate-100 px-4 font-semibold text-slate-700">+63</span>
                      <input
                        name="mobile_number"
                        value={profile.mobile_number}
                        onChange={handleProfileChange}
                        onBlur={handleContactBlur}
                        disabled={isProfileLocked}
                        inputMode="numeric"
                        maxLength={10}
                        className="w-full px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                        placeholder="9123456789"
                      />
                    </div>
                    {contactError ? <span className="mt-2 block text-xs font-medium text-rose-600">{contactError}</span> : null}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Taxpayer Type</span>
                    <CustomSelect
                      value={profile.taxpayer_type}
                      onChange={(val) => handleProfileChange({ target: { name: 'taxpayer_type', value: val } })}
                      disabled={isProfileLocked}
                      placeholder=""
                      options={[
                        { value: 'Individual', label: 'Individual' },
                        { value: 'Business Owner', label: 'Business Owner' },
                      ]}
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Address</span>
                    <input name="address" value={profile.address} onChange={handleProfileChange} disabled={isProfileLocked} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:ring-2 focus:ring-[#0f5b83]/10 ${addressError ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'}`} />
                    {addressError ? <span className="mt-2 block text-xs font-medium text-rose-600">{addressError}</span> : null}
                  </label>
                </div>

                <div className="mt-6 border-t border-slate-200 pt-5">
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordForm(DEFAULT_PASSWORD_FORM);
                      setPasswordError('');
                      setCurrentPasswordError('');
                      setNewPasswordError('');
                      setConfirmPasswordError('');
                      setShowPasswordModal(true);
                    }}
                    className="rounded-full border border-[#0f5b83] bg-white px-5 py-2.5 text-sm font-semibold text-[#0f5b83] transition hover:bg-[#eef8fc]"
                  >
                    Change Password
                  </button>
                </div>
              </form>

              {isProfileLocked ? (
                <form onSubmit={handleSubmitIdentifier} className="rounded-[28px] border border-slate-200 bg-[#f9fbff] p-6 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Verification Workflow</p>
                  <h2 className="mt-2 text-2xl font-bold text-slate-900">Submit Taxpayer Identifiers</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Submit identifiers together with a supporting document. Every submission is stored, emailed back to you, and marked <strong>Pending Verification</strong> until the Main Admin completes the review.
                  </p>

                  <div className="mt-6 grid gap-5">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">Submission Type</span>
                      <CustomSelect
                        value={identifierForm.submission_type}
                        onChange={(val) => handleIdentifierChange({ target: { name: 'submission_type', value: val } })}
                        placeholder=""
                        options={[
                          { value: 'RPT', label: 'Real Property Tax (RPT)' },
                          { value: 'BT', label: 'Business Tax (BT)' },
                        ]}
                      />
                    </label>

                    {identifierForm.submission_type === 'RPT' ? (
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-700">Tax Declaration Number (TDN)</span>
                        <input name="tdn" value={identifierForm.tdn} onChange={handleIdentifierChange} className={`w-full rounded-2xl border px-4 py-3 text-sm uppercase outline-none transition focus:ring-2 focus:ring-[#0f5b83]/10 ${identifierErrors.tdn ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'}`} />
                        {identifierErrors.tdn ? <span className="mt-2 block text-xs font-medium text-rose-600">{identifierErrors.tdn}</span> : null}
                      </label>
                    ) : (
                      <>
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">Mayor&apos;s Permit Number</span>
                          <input name="mayor_permit_number" value={identifierForm.mayor_permit_number} onChange={handleIdentifierChange} className={`w-full rounded-2xl border px-4 py-3 text-sm uppercase outline-none transition focus:ring-2 focus:ring-[#0f5b83]/10 ${identifierErrors.mayor_permit_number ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'}`} />
                          {identifierErrors.mayor_permit_number ? <span className="mt-2 block text-xs font-medium text-rose-600">{identifierErrors.mayor_permit_number}</span> : null}
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">SEC/DTI/CDA Registration Number</span>
                          <input name="sec_dti_cda_number" value={identifierForm.sec_dti_cda_number} onChange={handleIdentifierChange} className={`w-full rounded-2xl border px-4 py-3 text-sm uppercase outline-none transition focus:ring-2 focus:ring-[#0f5b83]/10 ${identifierErrors.sec_dti_cda_number ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'}`} />
                          {identifierErrors.sec_dti_cda_number ? <span className="mt-2 block text-xs font-medium text-rose-600">{identifierErrors.sec_dti_cda_number}</span> : null}
                        </label>
                      </>
                    )}

                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">Supporting File</span>
                      <input type="file" name="supporting_file" onChange={handleIdentifierChange} accept=".pdf,.png,.jpg,.jpeg" className={`mb-1 w-full cursor-pointer rounded-2xl border border-dashed bg-white px-4 py-3 text-sm shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-[#0f2f5f] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-blue-400 hover:bg-slate-50 focus:border-[#0f2f5f] focus:outline-none focus:ring-2 focus:ring-slate-200 transition ${identifierErrors.supporting_file ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
                      {identifierErrors.supporting_file ? <span className="mb-2 block text-xs font-medium text-rose-600">{identifierErrors.supporting_file}</span> : null}
                      <span className="mt-2 block text-xs text-slate-500">Accepted formats: PDF, PNG, JPG, JPEG only. Maximum 10MB.</span>
                    </label>

                    <button type="submit" disabled={submittingIdentifier} className="rounded-2xl bg-[#0f5b83] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60">
                      {submittingIdentifier ? 'Submitting...' : 'Submit for Verification'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="rounded-[28px] border border-dashed border-slate-300 bg-[#f9fbff] p-6 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Verification Workflow</p>
                  <h2 className="mt-2 text-2xl font-bold text-slate-900">Submit Taxpayer Identifiers</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Save your taxpayer information first to lock your profile and continue to the verification workflow for RPT or BT identifiers.
                  </p>
                </div>
              )}
            </div>

            {/* MFA Security Section */}
            <div className="mt-8 rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                    {language === 'en' ? 'Account Security' : 'Seguridad ng Account'}
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-slate-900">
                    {language === 'en' ? 'Multi-Factor Authentication' : 'Multi-Factor Authentication'}
                  </h2>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${mfaEnabled ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                  {mfaEnabled
                    ? (language === 'en' ? 'MFA Enabled' : 'MFA Naka-enable')
                    : (language === 'en' ? 'MFA Not Enabled' : 'MFA Hindi Naka-enable')}
                </span>
              </div>
              <p className="text-sm leading-6 text-slate-600">
                {mfaEnabled
                  ? (language === 'en'
                      ? 'Your account is protected with Multi-Factor Authentication. Each time you log in, you will need to enter a code from your Microsoft Authenticator app.'
                      : 'Protektado ang iyong account sa Multi-Factor Authentication. Sa bawat pag-login, kakailanganin mong ilagay ang code mula sa Microsoft Authenticator app.')
                  : (language === 'en'
                      ? 'Multi-Factor Authentication (MFA) adds an extra layer of security to your account. If enabled, your future logins will require both your email/password and a verification code from your Microsoft Authenticator app.'
                      : 'Ang Multi-Factor Authentication (MFA) ay nagdadagdag ng extra proteksyon sa iyong account. Kapag naka-enable, kakailanganin ang email/password at verification code mula sa Microsoft Authenticator app sa susunod na login.')}
              </p>
              {!mfaEnabled && (
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={handleStartMfaSetup}
                    className="rounded-full bg-[#0f5b83] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f]"
                  >
                    Set Up MFA
                  </button>
                </div>
              )}
              {mfaMessage && (
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {mfaMessage}
                </div>
              )}
            </div>

            <div className="mt-10 grid gap-8 xl:grid-cols-2">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Submission Status</p>
                    <h2 className="mt-2 text-2xl font-bold text-slate-900">Taxpayer Verification Queue</h2>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{submissions.length} submission{submissions.length === 1 ? '' : 's'}</span>
                </div>
                <div className="space-y-4">
                  {submissions.length ? submissions.map((submission) => (
                    <div key={submission.id} className="rounded-2xl border border-slate-200 bg-[#fbfdff] p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{submission.submission_type}</p>
                          <h3 className="mt-2 text-lg font-semibold text-slate-900">{submission.tdn || submission.mayor_permit_number}</h3>
                          {submission.sec_dti_cda_number ? <p className="mt-1 text-sm text-slate-600">SEC/DTI/CDA: {submission.sec_dti_cda_number}</p> : null}
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone[submission.status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                          {submission.status}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                        <p><strong>Submitted:</strong> {formatTimestamp(submission.created_at)}</p>
                        <p><strong>Reviewed:</strong> {formatTimestamp(submission.reviewed_at)}</p>
                      </div>
                      {submission.remarks ? <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700"><strong>Remarks:</strong> {submission.remarks}</p> : null}
                      {submission.supporting_file_name ? (
                        <button type="button" onClick={() => handleDownloadSubmission(submission)} className="mt-4 text-sm font-semibold text-[#0f5b83] hover:text-[#0c4d6f]">
                          Download {submission.supporting_file_name}
                        </button>
                      ) : null}
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                      No taxpayer identifier submissions yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-8">
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Online Payment Readiness</p>
                      <h2 className="mt-2 text-2xl font-bold text-slate-900">RPT Assessments</h2>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{rptAssessments.length} record{rptAssessments.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="space-y-4">
                    {rptAssessments.length ? rptAssessments.map((assessment) => (
                      <div key={assessment.id} className="rounded-2xl border border-slate-200 bg-[#fbfdff] p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">{assessment.tdn}</h3>
                            <p className="mt-1 text-sm text-slate-600">{assessment.property_address || 'No property address recorded.'}</p>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone[assessment.verification_status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                            {assessment.verification_status}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Fair Market Value</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{formatCurrency(assessment.fair_market_value)}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Final Amount Due</p>
                            <p className="mt-2 text-sm font-semibold text-[#0f5b83]">{formatCurrency(assessment.final_total_amount_due || assessment.amount_due)}</p>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                        No RPT assessments linked to this account yet.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Online Payment Readiness</p>
                      <h2 className="mt-2 text-2xl font-bold text-slate-900">BT Assessments</h2>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{btAssessments.length} record{btAssessments.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="space-y-4">
                    {btAssessments.length ? btAssessments.map((assessment) => (
                      <div key={assessment.id} className="rounded-2xl border border-slate-200 bg-[#fbfdff] p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">{assessment.business_name || assessment.mayor_permit_number}</h3>
                            <p className="mt-1 text-sm text-slate-600">Mayor&apos;s Permit: {assessment.mayor_permit_number}</p>
                            <p className="mt-1 text-sm text-slate-600">SEC/DTI/CDA: {assessment.sec_dti_cda_number}</p>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone[assessment.verification_status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                            {assessment.verification_status}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Annual Gross Sales</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{formatCurrency(assessment.annual_gross_sales)}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Assessment Amount</p>
                            <p className="mt-2 text-sm font-semibold text-[#0f5b83]">{formatCurrency(assessment.amount_due)}</p>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                        No Business Tax assessments linked to this account yet.
                      </div>
                    )}
                  </div>
                </div>

                {/* Queue History Section */}
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Transaction History</p>
                      <h2 className="mt-2 text-2xl font-bold text-slate-900">Queue History</h2>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{queueHistory.length} record{queueHistory.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="space-y-4">
                    {queueHistory.length ? queueHistory.map((queue) => (
                      <div key={queue.id} className="rounded-2xl border border-slate-200 bg-[#fbfdff] p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">{queue.queue_number}</h3>
                            <p className="mt-1 text-sm text-slate-600">{queue.branch_name}</p>
                            <p className="mt-0.5 text-sm text-slate-500">{queue.service_type}</p>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone[queue.status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                            {queue.status}
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                          <p><strong>Queue Type:</strong> {queue.queue_type}</p>
                          <p><strong>Created:</strong> {formatTimestamp(queue.created_at)}</p>
                          {queue.completed_at && <p><strong>Completed:</strong> {formatTimestamp(queue.completed_at)}</p>}
                          {queue.served_at && <p><strong>Served:</strong> {formatTimestamp(queue.served_at)}</p>}
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                        No queue history available yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showProfileConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <form onSubmit={handleConfirmSaveProfile} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Confirm Profile Update</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Enter Your Password</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Confirm your current account password before saving taxpayer profile changes.
            </p>
            {error ? (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Current Password</span>
              <input
                type="password"
                value={confirmProfilePassword}
                onChange={(event) => setConfirmProfilePassword(event.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10"
                autoComplete="current-password"
              />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowProfileConfirm(false);
                  setConfirmProfilePassword('');
                }}
                disabled={savingProfile}
                className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button type="submit" disabled={savingProfile} className="rounded-full bg-[#0f5b83] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60">
                {savingProfile ? 'Saving...' : 'Confirm and Save'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showPasswordModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <form onSubmit={handleChangePassword} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Account Security</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">Change Password</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Enter your current password, then choose and confirm a new password.
            </p>
            {passwordError ? (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {passwordError}
              </div>
            ) : null}
            <div className="mt-5 grid gap-4">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Current Password</span>
                <input name="current_password" type="password" value={passwordForm.current_password} onChange={handlePasswordFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition focus:ring-2 focus:ring-[#0f5b83]/10 ${currentPasswordError ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'}`} autoComplete="current-password" />
                {currentPasswordError ? <span className="mt-2 block text-xs font-medium text-rose-600">{currentPasswordError}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">New Password</span>
                <input name="new_password" type="password" value={passwordForm.new_password} onChange={handlePasswordFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition focus:ring-2 focus:ring-[#0f5b83]/10 ${newPasswordError ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'}`} autoComplete="new-password" />
                {newPasswordError ? <span className="mt-2 block text-xs font-medium text-rose-600">{newPasswordError}</span> : null}
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Confirm New Password</span>
                <input name="confirm_new_password" type="password" value={passwordForm.confirm_new_password} onChange={handlePasswordFormChange} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition focus:ring-2 focus:ring-[#0f5b83]/10 ${confirmPasswordError ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'}`} autoComplete="new-password" />
                {confirmPasswordError ? <span className="mt-2 block text-xs font-medium text-rose-600">{confirmPasswordError}</span> : null}
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordForm(DEFAULT_PASSWORD_FORM);
                  setPasswordError('');
                  setCurrentPasswordError('');
                  setNewPasswordError('');
                  setConfirmPasswordError('');
                }}
                disabled={changingPassword}
                className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button type="submit" disabled={changingPassword} className="rounded-full bg-[#0f5b83] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60">
                {changingPassword ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* MFA Setup Modal */}
      {showMfaSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              {mfaSetupLang === 'en' ? 'Account Security' : 'Seguridad ng Account'}
            </p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">MFA Setup</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {mfaSetupData
                ? (mfaSetupLang === 'en'
                    ? 'Please scan this QR code using your Microsoft Authenticator app to link your account. After scanning, enter the 6-digit verification code generated by the app to complete MFA setup.'
                    : 'I-scan ang QR code na ito gamit ang Microsoft Authenticator app para ma-link ang iyong account. Pagkatapos mag-scan, ilagay ang 6-digit verification code mula sa app para makumpleto ang MFA setup.')
                : (mfaSetupLang === 'en'
                    ? 'Enter your current password to start MFA setup.'
                    : 'Ilagay ang iyong kasalukuyang password para simulan ang MFA setup.')}
            </p>

            {mfaError && (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {mfaError}
              </div>
            )}

            {!mfaSetupData ? (
              <div className="mt-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">
                    {mfaSetupLang === 'en' ? 'Current Password' : 'Kasalukuyang Password'}
                  </span>
                  <input
                    type="password"
                    value={mfaPassword}
                    onChange={(event) => {
                      setMfaPassword(event.target.value);
                      setMfaError('');
                    }}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10"
                    autoComplete="current-password"
                  />
                </label>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleCancelMfaSetup}
                    disabled={mfaLoading}
                    className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    {mfaSetupLang === 'en' ? 'Cancel' : 'Kanselahin'}
                  </button>
                  <button
                    type="button"
                    onClick={handleRequestMfaSetup}
                    disabled={mfaLoading || !mfaPassword}
                    className="rounded-full bg-[#0f5b83] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60"
                  >
                    {mfaLoading
                      ? (mfaSetupLang === 'en' ? 'Generating...' : 'Nag-ge-generate...')
                      : (mfaSetupLang === 'en' ? 'Continue' : 'Magpatuloy')}
                  </button>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMfaSetupLang((prev) => (prev === 'en' ? 'tl' : 'en'))}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    {mfaSetupLang === 'en' ? 'Translate to Tagalog' : 'Translate to English'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-5">
                <div className="flex justify-center">
                  <img
                    src={mfaSetupData.qr_code}
                    alt={mfaSetupLang === 'en' ? 'MFA QR code' : 'MFA QR code'}
                    className="w-44 h-44 rounded-xl border-4 border-white shadow-lg object-contain"
                  />
                </div>
                <code className="block bg-slate-100 text-slate-700 p-3 rounded-xl text-xs break-all">
                  {mfaSetupData.manual_entry_key}
                </code>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">
                    {mfaSetupLang === 'en' ? 'Authenticator Code' : 'Authenticator Code'}
                  </span>
                  <input
                    type="text"
                    value={mfaTotpCode}
                    onChange={(event) => {
                      const nextValue = event.target.value.replace(/\D/g, '').slice(0, 6);
                      setMfaTotpCode(nextValue);
                      setMfaTotpError('');
                      setMfaError('');
                    }}
                    maxLength={6}
                    placeholder="000000"
                    className={`w-full rounded-2xl border px-4 py-3 text-sm text-center text-2xl tracking-[0.5em] font-mono outline-none transition ${mfaTotpError ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'} focus:ring-2 focus:ring-[#0f5b83]/10`}
                    autoComplete="one-time-code"
                  />
                  {mfaTotpError && (
                    <span className="mt-2 block text-xs font-medium text-rose-600">{mfaTotpError}</span>
                  )}
                </label>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleCancelMfaSetup}
                    disabled={mfaLoading}
                    className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    {mfaSetupLang === 'en' ? 'Cancel' : 'Kanselahin'}
                  </button>
                  <button
                    type="button"
                    onClick={handleVerifyMfaSetup}
                    disabled={mfaLoading || mfaTotpCode.length !== 6}
                    className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {mfaLoading
                      ? (mfaSetupLang === 'en' ? 'Verifying...' : 'Nagve-verify...')
                      : (mfaSetupLang === 'en' ? 'Verify & Enable MFA' : 'I-verify at I-enable ang MFA')}
                  </button>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setMfaSetupLang((prev) => (prev === 'en' ? 'tl' : 'en'))}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    {mfaSetupLang === 'en' ? 'Translate to Tagalog' : 'Translate to English'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default AccountManagement;
