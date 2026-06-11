import { useEffect, useState } from 'react';
import { windowStaffAccountAPI } from '../../services/api';
import WardsPageHero from '../../components/WardsPageHero';
import SystemMessageModal from '../../components/SystemMessageModal';
import ActionConfirmationModal from '../../components/ActionConfirmationModal';
import {
  getEmailValidationMessage,
  validateCitizenFullName,
  validateStrongPassword,
  validatePhilippineContactDigits,
  normalizePhilippineContactDigits,
  PASSWORD_RULE_MESSAGE,
} from '../../utils/validation';

// ---------------------------------------------------------------------------
// Shared input field
// ---------------------------------------------------------------------------
function Field({ label, id, type = 'text', value, onChange, error, disabled = false, hint }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-gray-700 mb-1">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`w-full px-4 py-2.5 border rounded-lg text-sm outline-none transition
          focus:ring-2 focus:ring-primary focus:border-transparent
          ${error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'}
          ${disabled ? 'bg-gray-100 cursor-not-allowed text-gray-400' : ''}`}
      />
      {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline modal shell (matches existing design)
// ---------------------------------------------------------------------------
function ModalShell({ eyebrow, title, onClose, closeDisabled, children }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between rounded-t-xl">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{eyebrow}</p>
            <h3 className="text-xl font-bold text-gray-900 mt-0.5">{title}</h3>
          </div>
          {onClose && (
            <button onClick={onClose} disabled={closeDisabled} className="text-gray-400 hover:text-gray-600 transition">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="px-8 py-6">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Profile Modal
// 3-step: edit → confirm changes → verify password
// ---------------------------------------------------------------------------
const EMPTY_EDIT = { full_name: '', email: '', contact_number: '' };

function EditProfileModal({ open, profile, onClose, onSuccess }) {
  // step: 'edit' | 'confirm' | 'verify'
  const [step, setStep] = useState('edit');
  const [form, setForm] = useState(EMPTY_EDIT);
  const [errors, setErrors] = useState({});
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && profile) {
      setForm({
        full_name: profile.full_name || '',
        email: profile.email || '',
        contact_number: profile.contact_number || '',
      });
      setErrors({});
      setPassword('');
      setPasswordError('');
      setStep('edit');
    }
  }, [open, profile]);

  const set = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const validateEdit = () => {
    const e = {};
    const nameErr = validateCitizenFullName(form.full_name);
    if (nameErr) e.full_name = nameErr;
    const emailErr = getEmailValidationMessage(form.email);
    if (emailErr) e.email = emailErr;
    if (!form.contact_number.trim()) {
      e.contact_number = 'Please enter your Contact Number.';
    } else {
      const digits = normalizePhilippineContactDigits(form.contact_number);
      const contactErr = validatePhilippineContactDigits(digits);
      if (contactErr) e.contact_number = contactErr;
    }
    return e;
  };

  const handleSaveClick = (ev) => {
    ev.preventDefault();
    const errs = validateEdit();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setStep('confirm');
  };

  const handleVerify = async (ev) => {
    ev.preventDefault();
    if (!password.trim()) { setPasswordError('Current password is required.'); return; }

    setSaving(true);
    try {
      const contactDigits = form.contact_number.trim()
        ? normalizePhilippineContactDigits(form.contact_number)
        : '';
      await windowStaffAccountAPI.updateProfile({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        contact_number: contactDigits || null,
        current_password: password,
      });
      onSuccess({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        contact_number: contactDigits || '',
      });
    } catch (err) {
      const detail = err?.response?.data?.detail || '';
      if (detail.toLowerCase().includes('incorrect') || detail.toLowerCase().includes('password')) {
        setPasswordError('The password you entered is incorrect. Please try again.');
      } else if (detail.toLowerCase().includes('email')) {
        // Go back to edit step to show email error
        setStep('edit');
        setErrors({ email: detail });
      } else {
        setPasswordError(detail || 'An error occurred. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  // ---- Step: Confirm Changes ----
  if (step === 'confirm') {
    const prevContact = profile?.contact_number || '—';
    const nextContact = form.contact_number.trim()
      ? normalizePhilippineContactDigits(form.contact_number) || '—'
      : '—';

    const fields = [
      {
        label: 'Full Name',
        prev: profile?.full_name || '—',
        next: form.full_name.trim() || '—',
      },
      {
        label: 'Email Address',
        prev: profile?.email || '—',
        next: form.email.trim() || '—',
      },
      {
        label: 'Contact Number',
        prev: prevContact,
        next: nextContact,
      },
    ];

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
          {/* Header */}
          <div className="border-b border-gray-200 px-8 py-5 rounded-t-xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Account Settings</p>
            <h3 className="text-xl font-bold text-gray-900 mt-0.5">Confirm Profile Changes</h3>
          </div>

          <div className="px-8 py-6 space-y-6">
            <p className="text-sm text-gray-600">
              Please review the following changes before proceeding:
            </p>

            {/* Two-column info panels */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Current Information */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Current Information
                  </p>
                </div>
                <div className="px-5 py-4 space-y-4">
                  {fields.map(({ label, prev }) => (
                    <div key={label}>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                        {label}
                      </p>
                      <p className="text-sm text-gray-700 break-all">{prev}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Updated Information */}
              <div className="rounded-xl border border-primary/30 overflow-hidden">
                <div className="bg-blue-50 px-5 py-3 border-b border-primary/20">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Updated Information
                  </p>
                </div>
                <div className="px-5 py-4 space-y-4">
                  {fields.map(({ label, prev, next }) => {
                    const changed = next !== prev;
                    return (
                      <div key={label}>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                          {label}
                        </p>
                        <p className={`text-sm break-all ${changed ? 'text-primary font-semibold' : 'text-gray-700'}`}>
                          {next}
                          {changed && (
                            <span className="ml-1.5 inline-block align-middle">
                              <svg className="w-3.5 h-3.5 text-primary inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                          )}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <p className="text-sm text-gray-600">Are you sure you want to save these changes?</p>

            {/* Buttons */}
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-1">
              <button type="button" onClick={() => setStep('edit')}
                className="px-5 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 transition">
                Cancel
              </button>
              <button type="button" onClick={() => { setPassword(''); setPasswordError(''); setStep('verify'); }}
                className="px-5 py-2.5 rounded-lg bg-primary hover:bg-secondary text-white text-sm font-semibold transition">
                Confirm Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step: Verify Identity ----
  if (step === 'verify') {
    return (
      <ModalShell eyebrow="Identity Verification" title="Verify Identity" onClose={() => setStep('confirm')} closeDisabled={saving}>
        <form onSubmit={handleVerify} className="space-y-4">
          <p className="text-sm text-gray-600">Please enter your current password to confirm these changes.</p>
          <Field
            label="Current Password"
            id="ep-verify-pw"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
            error={passwordError}
          />
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setStep('confirm')} disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 transition disabled:opacity-60">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-primary hover:bg-secondary text-white text-sm font-semibold transition disabled:opacity-60">
              {saving ? 'Verifying...' : 'Verify'}
            </button>
          </div>
        </form>
      </ModalShell>
    );
  }

  // ---- Step: Edit ----
  return (
    <ModalShell eyebrow="Account Settings" title="Edit Profile" onClose={onClose}>
      <form onSubmit={handleSaveClick} className="space-y-4">
        <Field label="Full Name" id="ep-name" value={form.full_name} onChange={set('full_name')} error={errors.full_name} />
        <Field label="Email Address" id="ep-email" type="email" value={form.email} onChange={set('email')} error={errors.email} />
        <Field
          label="Contact Number"
          id="ep-contact"
          value={form.contact_number}
          onChange={set('contact_number')}
          error={errors.contact_number}
          hint="Philippine mobile number — digits only, starting with 9 (e.g. 9171234567)."
        />
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose}
            className="px-5 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 transition">
            Cancel
          </button>
          <button type="submit"
            className="px-5 py-2.5 rounded-lg bg-primary hover:bg-secondary text-white text-sm font-semibold transition">
            Save Changes
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Change Password Modal
// 2-step: fill form → confirm → submit
// ---------------------------------------------------------------------------
const EMPTY_PW = { current_password: '', new_password: '', confirm_new_password: '' };

function ChangePasswordModal({ open, onClose, onSuccess }) {
  // step: 'form' | 'confirm'
  const [step, setStep] = useState('form');
  const [form, setForm] = useState(EMPTY_PW);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setForm(EMPTY_PW); setErrors({}); setStep('form'); }
  }, [open]);

  const set = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const validate = () => {
    const e = {};
    if (!form.current_password.trim()) e.current_password = 'Current password is required.';
    if (!form.new_password) {
      e.new_password = 'New password is required.';
    } else {
      const pwErr = validateStrongPassword(form.new_password);
      if (pwErr) e.new_password = pwErr;
    }
    if (!form.confirm_new_password) {
      e.confirm_new_password = 'Please confirm your new password.';
    } else if (form.new_password !== form.confirm_new_password) {
      e.confirm_new_password = 'The new passwords do not match.';
    }
    return e;
  };

  const handleUpdateClick = (ev) => {
    ev.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setStep('confirm');
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await windowStaffAccountAPI.changePassword({
        current_password: form.current_password,
        new_password: form.new_password,
        confirm_new_password: form.confirm_new_password,
      });
      onSuccess();
    } catch (err) {
      setStep('form');
      const detail = err?.response?.data?.detail || '';
      if (detail.toLowerCase().includes('incorrect') || detail.toLowerCase().includes('password')) {
        setErrors({ current_password: 'The password you entered is incorrect. Please try again.' });
      } else if (detail.toLowerCase().includes('match')) {
        setErrors({ confirm_new_password: 'The new passwords do not match.' });
      } else {
        setErrors({ current_password: detail || 'An error occurred. Please try again.' });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  // ---- Step: Confirm ----
  if (step === 'confirm') {
    return (
      <ActionConfirmationModal
        open
        tone="primary"
        title="Confirm Password Change"
        message="You are about to change your account password. Are you sure you want to proceed?"
        confirmLabel={saving ? 'Processing...' : 'Confirm Password Change'}
        cancelLabel="Cancel"
        isLoading={saving}
        onCancel={() => setStep('form')}
        onConfirm={handleConfirm}
      />
    );
  }

  // ---- Step: Form ----
  return (
    <ModalShell eyebrow="Security" title="Change Password" onClose={onClose}>
      <form onSubmit={handleUpdateClick} className="space-y-4">
        <Field label="Current Password" id="cp-current" type="password" value={form.current_password} onChange={set('current_password')} error={errors.current_password} />
        <Field
          label="New Password"
          id="cp-new"
          type="password"
          value={form.new_password}
          onChange={set('new_password')}
          error={errors.new_password}
          hint={PASSWORD_RULE_MESSAGE}
        />
        <Field label="Confirm New Password" id="cp-confirm" type="password" value={form.confirm_new_password} onChange={set('confirm_new_password')} error={errors.confirm_new_password} />
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose}
            className="px-5 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 transition">
            Cancel
          </button>
          <button type="submit"
            className="px-5 py-2.5 rounded-lg bg-primary hover:bg-secondary text-white text-sm font-semibold transition">
            Update Password
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Reset MFA Modal
// 4-step: confirm → verify password → QR/setup → enter code
// ---------------------------------------------------------------------------
function ResetMFAModal({ open, onClose, onSuccess }) {
  // step: 'confirm' | 'password' | 'setup' | 'verify'
  const [step, setStep] = useState('confirm');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('confirm');
      setPassword('');
      setPasswordError('');
      setQrCode('');
      setManualKey('');
      setTotpCode('');
      setTotpError('');
    }
  }, [open]);

  const handlePasswordSubmit = async (ev) => {
    ev.preventDefault();
    if (!password.trim()) { setPasswordError('Current password is required.'); return; }
    setSaving(true);
    try {
      const res = await windowStaffAccountAPI.resetMfa({ current_password: password });
      setQrCode(res.data.qr_code);
      setManualKey(res.data.manual_entry_key);
      setTotpCode('');
      setTotpError('');
      setStep('setup');
    } catch (err) {
      const detail = err?.response?.data?.detail || '';
      if (detail.toLowerCase().includes('incorrect') || detail.toLowerCase().includes('password')) {
        setPasswordError('The password you entered is incorrect. Please try again.');
      } else {
        setPasswordError(detail || 'Unable to reset MFA. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyTotp = async (ev) => {
    ev.preventDefault();
    if (!totpCode.trim()) { setTotpError('Verification code is required.'); return; }
    setSaving(true);
    try {
      await windowStaffAccountAPI.verifyMfa({ totp_code: totpCode.trim() });
      onSuccess();
    } catch (err) {
      const detail = err?.response?.data?.detail || '';
      if (detail.toLowerCase().includes('invalid') || detail.toLowerCase().includes('code')) {
        setTotpError('The authentication code entered is invalid. Please try again.');
      } else {
        setTotpError(detail || 'Verification failed. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  // ---- Step: Confirm ----
  if (step === 'confirm') {
    return (
      <ActionConfirmationModal
        open
        tone="danger"
        title="Reset Multi-Factor Authentication"
        message="Are you sure you want to reset your Multi-Factor Authentication? Your current MFA configuration will be removed and replaced with a new one."
        confirmLabel="Reset MFA"
        cancelLabel="Cancel"
        onCancel={onClose}
        onConfirm={() => setStep('password')}
      />
    );
  }

  // ---- Step: Password Verification ----
  if (step === 'password') {
    return (
      <ModalShell eyebrow="Identity Verification" title="Verify Identity" onClose={onClose} closeDisabled={saving}>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <p className="text-sm text-gray-600">Please enter your current password to confirm these changes.</p>
          <Field
            label="Current Password"
            id="mfa-pw"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
            error={passwordError}
          />
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 transition disabled:opacity-60">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition disabled:opacity-60">
              {saving ? 'Resetting...' : 'Verify'}
            </button>
          </div>
        </form>
      </ModalShell>
    );
  }

  // ---- Step: QR / Setup ----
  if (step === 'setup') {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-gray-200 px-8 py-5 rounded-t-xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">MFA Setup</p>
            <h3 className="text-xl font-bold text-gray-900 mt-0.5">Configure Authenticator</h3>
          </div>
          <div className="px-8 py-6 space-y-5">
            <ol className="space-y-1 text-sm text-gray-600 list-decimal list-inside">
              <li>Open your authenticator application.</li>
              <li>Scan the QR Code below.</li>
              <li>Enter the generated verification code to complete setup.</li>
            </ol>

            {qrCode && (
              <div className="flex justify-center">
                <img src={qrCode} alt="MFA QR Code" className="w-48 h-48 border border-gray-200 rounded-lg" />
              </div>
            )}

            {manualKey && (
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Manual Setup Key</p>
                <p className="text-sm font-mono text-gray-800 break-all select-all">{manualKey}</p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="px-5 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 transition">
                Cancel
              </button>
              <button type="button" onClick={() => { setTotpCode(''); setTotpError(''); setStep('verify'); }}
                className="px-5 py-2.5 rounded-lg bg-primary hover:bg-secondary text-white text-sm font-semibold transition">
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step: Verify TOTP ----
  return (
    <ModalShell eyebrow="MFA Setup" title="Complete MFA Setup" onClose={() => setStep('setup')} closeDisabled={saving}>
      <form onSubmit={handleVerifyTotp} className="space-y-4">
        <p className="text-sm text-gray-600">
          Enter the 6-digit code generated by your authenticator app to complete setup.
        </p>
        <Field
          label="Verification Code"
          id="mfa-totp"
          value={totpCode}
          onChange={(e) => { setTotpCode(e.target.value); setTotpError(''); }}
          error={totpError}
          hint="Enter the 6-digit code from your authenticator app."
        />
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={() => setStep('setup')} disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 transition disabled:opacity-60">
            Back
          </button>
          <button type="submit" disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-primary hover:bg-secondary text-white text-sm font-semibold transition disabled:opacity-60">
            {saving ? 'Verifying...' : 'Verify and Complete Setup'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
const WindowStaffAccount = () => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showResetMFA, setShowResetMFA] = useState(false);
  const [systemMessage, setSystemMessage] = useState(null);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const res = await windowStaffAccountAPI.getProfile();
      setProfile(res.data);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProfile(); }, []);

  const showSuccess = (title, message) => setSystemMessage({ tone: 'success', title, message });

  const handleProfileSuccess = (updated) => {
    try {
      const stored = JSON.parse(localStorage.getItem('branchUser') || '{}');
      localStorage.setItem('branchUser', JSON.stringify({ ...stored, ...updated }));
    } catch { /* ignore */ }
    setProfile((prev) => ({ ...prev, ...updated }));
    setShowEditProfile(false);
    showSuccess('Profile Updated Successfully', 'Your profile information has been updated successfully.');
  };

  const handlePasswordSuccess = () => {
    setShowChangePassword(false);
    showSuccess('Password Updated Successfully', 'Your password has been changed successfully.');
  };

  const handleMFASuccess = () => {
    setShowResetMFA(false);
    showSuccess('MFA Configured Successfully', 'Your Multi-Factor Authentication has been successfully reconfigured.');
  };

  const initials = (profile?.full_name || profile?.username || 'W').charAt(0).toUpperCase();
  const staff = JSON.parse(localStorage.getItem('branchUser') || '{}');
  const rawLabel = staff?.window_label || staff?.service_window_label || staff?.service_window || '';
  const windowLabel = rawLabel.replace(/\s+Window$/i, '') || 'Queue Window';
  const physicalWindow = staff?.assigned_window_number ? `Window ${staff.assigned_window_number}` : null;
  const roleDisplay = [physicalWindow, windowLabel].filter(Boolean).join(' - ');

  if (loading) {
    return (
      <div className="h-96 flex items-center justify-center">
        <div className="text-center">
          <div className="border-4 border-primary border-t-transparent rounded-full w-12 h-12 mx-auto mb-4 animate-spin" />
          <p className="text-gray-600">Loading account information...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <WardsPageHero
        eyebrow="Branch Portal"
        title="Account Management"
        subtitle="View and manage your own account information and security settings."
        className="mb-6"
      />

      {/* Profile overview card */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="flex items-center gap-5 mb-6">
          <div className="flex-shrink-0 h-16 w-16 rounded-full bg-primary flex items-center justify-center text-white text-2xl font-bold">
            {initials}
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{profile?.full_name || profile?.username || 'Window Staff'}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{profile?.email}</p>
            <span className="mt-1.5 inline-block rounded-full bg-blue-100 px-3 py-0.5 text-xs font-semibold text-blue-700">
              {roleDisplay}
            </span>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Full Name</p>
            <p className="text-sm font-medium text-gray-800">{profile?.full_name || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Email Address</p>
            <p className="text-sm font-medium text-gray-800">{profile?.email || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Contact Number</p>
            <p className="text-sm font-medium text-gray-800">{profile?.contact_number || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Service Window</p>
            <p className="text-sm font-medium text-gray-800">{roleDisplay || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Branch ID</p>
            <p className="text-sm font-medium text-gray-800">{profile?.branch_id ?? '—'}</p>
          </div>
        </div>
      </div>

      {/* Action cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Edit Profile */}
        <button
          onClick={() => setShowEditProfile(true)}
          className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-primary text-left transition hover:shadow-lg"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-primary">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <h3 className="font-bold text-gray-900">Edit Profile</h3>
          </div>
          <p className="text-sm text-gray-500">Update your name, email address, and contact number.</p>
        </button>

        {/* Change Password */}
        <button
          onClick={() => setShowChangePassword(true)}
          className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-green-500 text-left transition hover:shadow-lg"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-green-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="font-bold text-gray-900">Change Password</h3>
          </div>
          <p className="text-sm text-gray-500">Update your account password securely.</p>
        </button>

        {/* Reset MFA */}
        <button
          onClick={() => setShowResetMFA(true)}
          className="bg-white rounded-xl shadow-md p-5 border-l-4 border-l-red-500 text-left transition hover:shadow-lg"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center text-red-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="font-bold text-gray-900">Reset MFA</h3>
          </div>
          <p className="text-sm text-gray-500">Re-enroll your Microsoft Authenticator app.</p>
        </button>
      </div>

      {/* Modals */}
      <EditProfileModal
        open={showEditProfile}
        profile={profile}
        onClose={() => setShowEditProfile(false)}
        onSuccess={handleProfileSuccess}
      />
      <ChangePasswordModal
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        onSuccess={handlePasswordSuccess}
      />
      <ResetMFAModal
        open={showResetMFA}
        onClose={() => setShowResetMFA(false)}
        onSuccess={handleMFASuccess}
      />

      <SystemMessageModal
        open={Boolean(systemMessage)}
        tone={systemMessage?.tone}
        title={systemMessage?.title}
        message={systemMessage?.message}
        buttonLabel="OK"
        onClose={() => setSystemMessage(null)}
      />
    </div>
  );
};

export default WindowStaffAccount;
