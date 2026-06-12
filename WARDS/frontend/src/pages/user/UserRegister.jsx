import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import ReCAPTCHA from 'react-google-recaptcha';

import DataPrivacyAgreementCard from '../../components/DataPrivacyAgreementCard';
import SystemMessageModal from '../../components/SystemMessageModal';
import {
  getEmailValidationMessage,
  normalizeCitizenFullName,
  normalizePhilippineContactDigits,
  validateCitizenFullName,
  validatePhilippineContactDigits,
  validateStrongPassword,
} from '../../utils/validation';

const API_URL = 'http://localhost:8000';
const RECAPTCHA_SITE_KEY = '6LdOdsAsAAAAAKW-mZvEfaesLvdAwCm_SnZoiirK';
const EyeIcon = ({ open }) => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {open ? (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </>
    ) : (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.956 9.956 0 012.2-3.592M6.223 6.223A9.965 9.965 0 0112 5c4.478 0 8.268 2.943 9.542 7a9.97 9.97 0 01-4.132 5.411M15 12a3 3 0 00-4.755-2.455M9.88 9.88A3 3 0 0014.12 14.12M3 3l18 18" />
      </>
    )}
  </svg>
);

const initialFormState = {
  email: '',
  full_name: '',
  contact_number: '',
  address: '',
  password: '',
  confirmPassword: '',
};

const getRegistrationEmailError = (value) => {
  if (!String(value || '').trim()) {
    return 'Please enter your Email Address.';
  }

  return getEmailValidationMessage(value, { required: false }).replace('Please enter a valid email address.', 'Please enter a valid Email Address.');
};

const getRegistrationFullNameError = (value) => {
  if (!String(value || '').trim()) {
    return 'Please enter your Full Name.';
  }

  return validateCitizenFullName(value);
};

const getRegistrationContactError = (value) => {
  if (!String(value || '').trim()) {
    return 'Please enter your Contact Number.';
  }

  return validatePhilippineContactDigits(value)
    .replace('Contact number must begin with 9 and contain exactly 10 digits.', 'Please enter a valid Contact Number.');
};

const getRegistrationPasswordError = (value) => {
  if (!String(value || '')) {
    return 'Please enter your Password.';
  }

  return validateStrongPassword(value);
};

const getRegistrationConfirmPasswordError = (password, confirmPassword) => {
  if (!String(confirmPassword || '')) {
    return 'Please confirm your Password.';
  }

  return password === confirmPassword ? '' : 'Passwords do not match.';
};

const UserRegister = () => {
  const navigate = useNavigate();
  const agreementScrollRef = useRef(null);
  const recaptchaRef = useRef(null);

  const [formData, setFormData] = useState(initialFormState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [fullNameError, setFullNameError] = useState('');
  const [contactError, setContactError] = useState('');
  const [contactCheckingUniqueness, setContactCheckingUniqueness] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [agreement, setAgreement] = useState(null);
  const [agreementError, setAgreementError] = useState('');
  const [agreementLoading, setAgreementLoading] = useState(true);
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [hasReachedAgreementEnd, setHasReachedAgreementEnd] = useState(false);
  const [hasAcceptedAgreement, setHasAcceptedAgreement] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [successModal, setSuccessModal] = useState({
    open: false,
    title: '',
    message: '',
    buttonLabel: 'Proceed to Login',
    onCloseRedirect: null,
  });

  useEffect(() => {
    let isMounted = true;

    const loadAgreement = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/privacy/data-privacy-agreement`);
        if (isMounted) {
          setAgreement(response.data);
        }
      } catch {
        if (isMounted) {
          setAgreementError('Unable to load the Data Privacy Agreement. Please refresh and try again.');
        }
      } finally {
        if (isMounted) {
          setAgreementLoading(false);
        }
      }
    };

    loadAgreement();
    return () => {
      isMounted = false;
    };
  }, []);

  const resetRecaptcha = () => {
    setRecaptchaToken('');
    if (recaptchaRef.current) {
      recaptchaRef.current.reset();
    }
  };

  const handleAgreementScroll = (event) => {
    if (hasReachedAgreementEnd) {
      return;
    }

    const target = event.currentTarget;
    const scrolledToBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 8;
    if (scrolledToBottom) {
      setHasReachedAgreementEnd(true);
    }
  };

  const openAgreementModal = () => {
    if (agreementLoading || agreementError || !agreement || hasAcceptedAgreement) {
      return;
    }
    setHasReachedAgreementEnd(false);
    setShowAgreementModal(true);
  };

  const handleConsentIntent = () => {
    if (hasAcceptedAgreement) {
      setHasAcceptedAgreement(false);
      setHasReachedAgreementEnd(false);
      resetRecaptcha();
      return;
    }
    openAgreementModal();
  };

  const handleAgreementModalClose = () => {
    if (!hasReachedAgreementEnd) {
      return;
    }
    setHasAcceptedAgreement(true);
    setShowAgreementModal(false);
    resetRecaptcha();
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
    setError('');

    if (name === 'email') {
      setEmailError(getRegistrationEmailError(value));
    }

    if (name === 'full_name') {
      setFullNameError(getRegistrationFullNameError(value));
    }

    if (name === 'contact_number') {
      const normalizedDigits = normalizePhilippineContactDigits(value);
      setFormData((current) => ({ ...current, contact_number: normalizedDigits }));
      setContactError(getRegistrationContactError(normalizedDigits));
      return;
    }

    if (name === 'password') {
      setPasswordError(getRegistrationPasswordError(value));
      setConfirmPasswordError(getRegistrationConfirmPasswordError(value, formData.confirmPassword));
    }

    if (name === 'confirmPassword') {
      setConfirmPasswordError(getRegistrationConfirmPasswordError(formData.password, value));
    }
  };

  const handleContactBlur = async () => {
    const digits = formData.contact_number;
    const formatError = getRegistrationContactError(digits);
    if (formatError) {
      setContactError(formatError);
      return;
    }
    setContactCheckingUniqueness(true);
    try {
      const response = await axios.post(`${API_URL}/api/user/auth/check-contact`, {
        contact_number: `+63${digits}`,
      });
      if (!response.data.available) {
        setContactError('This contact number is unavailable. Please enter a different contact number.');
      }
    } catch {
      // silently skip — server-side will catch it on submit
    } finally {
      setContactCheckingUniqueness(false);
    }
  };

  const canSubmit = useMemo(() => {
    return (
      !agreementLoading &&
      !showAgreementModal &&
      !contactCheckingUniqueness
    );
  }, [
    agreementLoading,
    showAgreementModal,
    contactCheckingUniqueness,
  ]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (loading || successModal.open) {
      return;
    }

    setLoading(true);
    setError('');

    const nextEmailError = getRegistrationEmailError(formData.email);
    const nextFullNameError = getRegistrationFullNameError(formData.full_name);
    const nextContactError = getRegistrationContactError(formData.contact_number);
    const nextPasswordError = getRegistrationPasswordError(formData.password);
    const nextConfirmPasswordError = getRegistrationConfirmPasswordError(formData.password, formData.confirmPassword);

    setEmailError(nextEmailError);
    setFullNameError(nextFullNameError);
    setContactError(nextContactError);
    setPasswordError(nextPasswordError);
    setConfirmPasswordError(nextConfirmPasswordError);

    if (
      nextEmailError ||
      nextFullNameError ||
      nextContactError ||
      nextPasswordError ||
      nextConfirmPasswordError
    ) {
      setError('Please review the highlighted fields.');
      setLoading(false);
      return;
    }

    if (!hasAcceptedAgreement || !agreement?.version) {
      setError('You must accept the Data Privacy Agreement before registering.');
      setLoading(false);
      return;
    }

    if (!recaptchaToken) {
      setError('Please complete the reCAPTCHA verification.');
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/api/user/auth/register`, {
        email: formData.email.trim(),
        full_name: normalizeCitizenFullName(formData.full_name),
        contact_number: `+63${normalizePhilippineContactDigits(formData.contact_number)}`,
        address: formData.address,
        password: formData.password,
        dpa_consent: true,
        dpa_version: agreement.version,
        recaptcha_token: recaptchaToken,
      });

      if (response.data.requires_email_verification) {
        const pendingVerification = {
          email: formData.email.trim(),
          fullName: formData.full_name,
          source: 'register',
          message: response.data.message || 'We sent a 6-digit verification code to your email. Enter it to activate your account.',
          resendAvailableInSeconds: response.data.resend_available_in_seconds || 120,
        };

        sessionStorage.setItem('pendingCitizenVerification', JSON.stringify(pendingVerification));
        setSuccessModal({
          open: true,
          title: 'Registration Successful',
          message: 'Your WARDS Citizen Account has been successfully created. Please verify your email before logging in.',
          buttonLabel: 'Proceed to Verification',
          onCloseRedirect: () => {
            navigate('/user/verify-email', {
              replace: true,
              state: pendingVerification,
            });
          },
        });
        return;
      }

      setSuccessModal({
        open: true,
        title: 'Registration Successful',
        message: 'Your WARDS Citizen Account has been successfully created. You may now proceed to login and access the system.',
        buttonLabel: 'Proceed to Login',
        onCloseRedirect: () => {
          navigate('/login?portal=public', { replace: true });
        },
      });
    } catch (requestError) {
      const detail = requestError.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Registration failed. Please try again.');
      resetRecaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-emerald-700 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">

          {/* Header */}
          <div className="mb-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Citizen Account Setup</p>
            <h1 className="mt-2 text-3xl font-bold text-white">Create your account</h1>
            <p className="mt-2 text-sm text-emerald-100/70">Fill in your details below to get started.</p>
          </div>

          {/* Card */}
          <div className="rounded-3xl bg-white shadow-2xl shadow-black/20">

            {/* Error banner */}
            {error ? (
              <div className="rounded-t-3xl border-b border-rose-100 bg-rose-50 px-6 py-4 text-sm font-medium text-rose-700">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} noValidate className="divide-y divide-slate-100">

              {/* Personal Information */}
              <div className="px-6 py-6 sm:px-8">
                <p className="mb-5 text-xs font-semibold uppercase tracking-widest text-slate-400">Personal Information</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Full Name</label>
                    <input
                      type="text"
                      name="full_name"
                      value={formData.full_name}
                      onChange={handleChange}
                      placeholder="Juan Dela Cruz"
                      aria-invalid={fullNameError ? 'true' : 'false'}
                      className={`w-full rounded-xl border px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/30 ${fullNameError ? 'border-rose-300 bg-rose-50 focus:border-rose-400' : 'border-slate-200 bg-white focus:border-emerald-400'}`}
                      required
                    />
                    {fullNameError ? <p className="mt-1.5 text-xs font-medium text-rose-600">{fullNameError}</p> : null}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Email Address</label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="you@example.com"
                      aria-invalid={emailError ? 'true' : 'false'}
                      className={`w-full rounded-xl border px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/30 ${emailError ? 'border-rose-300 bg-rose-50 focus:border-rose-400' : 'border-slate-200 bg-white focus:border-emerald-400'}`}
                      required
                    />
                    {emailError ? <p className="mt-1.5 text-xs font-medium text-rose-600">{emailError}</p> : null}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Contact Number</label>
                    <div className={`flex overflow-hidden rounded-xl border transition focus-within:ring-2 focus-within:ring-emerald-500/30 ${contactError ? 'border-rose-300 bg-rose-50 focus-within:border-rose-400' : 'border-slate-200 bg-white focus-within:border-emerald-400'}`}>
                      <span className="flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-500">+63</span>
                      <input
                        type="tel"
                        name="contact_number"
                        value={formData.contact_number}
                        onChange={handleChange}
                        onBlur={handleContactBlur}
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="9123456789"
                        aria-invalid={contactError ? 'true' : 'false'}
                        className="w-full bg-transparent px-4 py-2.5 text-sm text-slate-900 outline-none"
                        required
                      />
                    </div>
                    {contactError ? <p className="mt-1.5 text-xs font-medium text-rose-600">{contactError}</p> : null}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Address <span className="text-slate-400">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      name="address"
                      value={formData.address}
                      onChange={handleChange}
                      placeholder="Street, barangay, city"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>
              </div>

              {/* Account Security */}
              <div className="px-6 py-6 sm:px-8">
                <p className="mb-5 text-xs font-semibold uppercase tracking-widest text-slate-400">Account Security</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        value={formData.password}
                        onChange={handleChange}
                        placeholder="Create a strong password"
                        aria-invalid={passwordError ? 'true' : 'false'}
                        className={`w-full rounded-xl border px-4 py-2.5 pr-11 text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/30 ${passwordError ? 'border-rose-300 bg-rose-50 focus:border-rose-400' : 'border-slate-200 bg-white focus:border-emerald-400'}`}
                        required
                      />
                      {formData.password ? (
                        <button
                          type="button"
                          onClick={() => setShowPassword((c) => !c)}
                          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition hover:text-slate-600"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          <EyeIcon open={showPassword} />
                        </button>
                      ) : null}
                    </div>
                    {passwordError ? (
                      <p className="mt-1.5 text-xs font-medium text-rose-600">{passwordError}</p>
                    ) : (
                      <p className="mt-1.5 text-xs text-slate-400">12+ chars, uppercase, lowercase, number or symbol.</p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Confirm Password</label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        name="confirmPassword"
                        value={formData.confirmPassword}
                        onChange={handleChange}
                        placeholder="Re-enter your password"
                        aria-invalid={confirmPasswordError ? 'true' : 'false'}
                        className={`w-full rounded-xl border px-4 py-2.5 pr-11 text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-emerald-500/30 ${confirmPasswordError ? 'border-rose-300 bg-rose-50 focus:border-rose-400' : 'border-slate-200 bg-white focus:border-emerald-400'}`}
                        required
                      />
                      {formData.confirmPassword ? (
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword((c) => !c)}
                          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition hover:text-slate-600"
                          aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                        >
                          <EyeIcon open={showConfirmPassword} />
                        </button>
                      ) : null}
                    </div>
                    {confirmPasswordError ? <p className="mt-1.5 text-xs font-medium text-rose-600">{confirmPasswordError}</p> : null}
                  </div>
                </div>
              </div>

              {/* DPA + reCAPTCHA */}
              <div className="px-6 py-6 sm:px-8">
                {agreementLoading ? (
                  <p className="text-sm font-medium text-emerald-700">Loading Data Privacy Agreement...</p>
                ) : agreementError ? (
                  <p className="text-sm font-medium text-rose-600">{agreementError}</p>
                ) : (
                  <div className="flex flex-col gap-5">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={hasAcceptedAgreement}
                        onChange={handleConsentIntent}
                        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-emerald-600"
                      />
                      <span className="text-sm text-slate-600">
                        I have read and agree to the{' '}
                        <Link to="/data-privacy-agreement" className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline">
                          Data Privacy Agreement
                        </Link>
                      </span>
                    </label>

                    {hasAcceptedAgreement && (
                      <div className="flex justify-center">
                        <ReCAPTCHA
                          ref={recaptchaRef}
                          sitekey={RECAPTCHA_SITE_KEY}
                          onChange={(token) => {
                            setRecaptchaToken(token || '');
                            setError('');
                          }}
                          onExpired={() => setRecaptchaToken('')}
                          onErrored={() => {
                            setRecaptchaToken('');
                            setError('reCAPTCHA verification failed. Please try again.');
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex flex-col-reverse gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <Link
                  to="/login"
                  className="text-center text-sm font-medium text-slate-500 transition hover:text-slate-700"
                >
                  Already have an account? <span className="font-semibold text-emerald-600 hover:text-emerald-700">Log in</span>
                </Link>
                <button
                  type="submit"
                  disabled={loading || !canSubmit}
                  className="rounded-xl bg-emerald-600 px-8 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Creating Account…' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {showAgreementModal && agreement ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dpa-modal-title"
        >
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl shadow-black/30">
            <div className="border-b border-slate-100 px-6 py-5 sm:px-8">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">Required Review</p>
              <h2 id="dpa-modal-title" className="mt-1.5 text-xl font-bold text-slate-900">
                Data Privacy Agreement
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Scroll to the bottom to enable the accept button.
              </p>
            </div>

            <div className="px-6 py-5 sm:px-8">
              <DataPrivacyAgreementCard
                agreement={agreement}
                scrollable
                onScroll={handleAgreementScroll}
                containerRef={agreementScrollRef}
                className="border border-slate-200 shadow-none"
                footer={
                  <div className={`rounded-xl px-4 py-3 text-sm ${hasReachedAgreementEnd ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>
                    {hasReachedAgreementEnd
                      ? 'You\'ve reached the end. You may now accept the agreement.'
                      : 'Please scroll to the end of the agreement to continue.'}
                  </div>
                }
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 sm:px-8">
              <button
                type="button"
                onClick={handleAgreementModalClose}
                disabled={!hasReachedAgreementEnd}
                className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Accept &amp; Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SystemMessageModal
        open={successModal.open}
        tone="success"
        title={successModal.title}
        message={successModal.message}
        buttonLabel={successModal.buttonLabel}
        onClose={() => {
          const redirectAction = successModal.onCloseRedirect;
          setSuccessModal({
            open: false,
            title: '',
            message: '',
            buttonLabel: 'Proceed to Login',
            onCloseRedirect: null,
          });
          if (redirectAction) {
            redirectAction();
          }
        }}
      />
    </>
  );
};

export default UserRegister;
