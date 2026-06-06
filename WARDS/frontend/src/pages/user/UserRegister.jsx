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

  const canSubmit = useMemo(() => {
    return (
      !agreementLoading &&
      !showAgreementModal
    );
  }, [
    agreementLoading,
    showAgreementModal,
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
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#86efac_0%,#166534_28%,#0f172a_100%)] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <section className="rounded-[30px] bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.24)] sm:p-7 lg:min-h-[760px]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">Citizen Account Setup</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">Create Account</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Complete your information, finish the privacy review, verify reCAPTCHA, then submit your registration.
                </p>
              </div>
            </div>

            {error ? (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm font-semibold text-rose-700">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-5">
              <div className="grid gap-5 lg:grid-cols-[1.02fr_0.98fr]">
                <div className="rounded-[26px] border border-slate-200 bg-slate-50/70 px-4 py-5 sm:px-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Personal Information</p>
                  <div className="mt-4 grid gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Full Name</label>
                      <input
                        type="text"
                        name="full_name"
                        value={formData.full_name}
                        onChange={handleChange}
                        placeholder="Juan Dela Cruz"
                        aria-invalid={fullNameError ? 'true' : 'false'}
                        className={`w-full rounded-2xl border px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 ${fullNameError ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white'}`}
                        required
                      />
                      {fullNameError ? <p className="mt-2 text-sm font-semibold text-rose-600">{fullNameError}</p> : null}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Email Address</label>
                      <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                        placeholder="your.email@example.com"
                        aria-invalid={emailError ? 'true' : 'false'}
                        className={`w-full rounded-2xl border px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 ${emailError ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white'}`}
                        required
                      />
                      {emailError ? <p className="mt-2 text-sm font-semibold text-rose-600">{emailError}</p> : null}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Contact Number</label>
                      <div className={`flex overflow-hidden rounded-2xl border ${contactError ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white'} focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-100`}>
                        <span className="flex items-center border-r border-slate-200 px-4 text-sm font-semibold text-slate-600">+63</span>
                        <input
                          type="tel"
                          name="contact_number"
                          value={formData.contact_number}
                          onChange={handleChange}
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="9123456789"
                          aria-invalid={contactError ? 'true' : 'false'}
                          className="w-full bg-transparent px-4 py-3 text-sm text-slate-900 outline-none"
                          required
                        />
                      </div>
                      {contactError ? (
                        <p className="mt-2 text-sm font-semibold text-rose-600">{contactError}</p>
                      ) : null}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">Address (Optional)</label>
                      <input
                        type="text"
                        name="address"
                        value={formData.address}
                        onChange={handleChange}
                        placeholder="House number, street, barangay, city"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                      />
                    </div>

                    <div className={`rounded-[26px] border px-4 py-5 sm:px-5 ${hasAcceptedAgreement ? 'border-sky-100 bg-sky-50/70' : 'border-slate-200 bg-slate-50/70'}`}>
                      <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${hasAcceptedAgreement ? 'text-sky-700' : 'text-slate-400'}`}>
                        reCAPTCHA Verification
                      </p>
                      <p className="mt-3 text-sm text-slate-500">
                        {hasAcceptedAgreement
                          ? 'Complete the reCAPTCHA challenge to confirm this registration is being submitted by a real person.'
                          : 'Finish the Data Privacy Agreement step first to unlock reCAPTCHA verification.'}
                      </p>
                      <div className="mt-4 flex justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5">
                        {hasAcceptedAgreement ? (
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
                        ) : (
                          <p className="text-sm font-semibold text-slate-400">reCAPTCHA will appear here after the DPA review is completed.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-5">
                  <div className="rounded-[26px] border border-slate-200 bg-slate-50/70 px-4 py-5 sm:px-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Account Security</p>
                    <div className="mt-4 grid gap-4">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Password</label>
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            placeholder="Create a strong password"
                            aria-invalid={passwordError ? 'true' : 'false'}
                            className={`w-full rounded-2xl border px-4 py-3 pr-12 text-sm text-slate-900 outline-none transition focus:ring-4 ${passwordError ? 'border-rose-400 bg-rose-50 focus:border-rose-500 focus:ring-rose-100' : 'border-slate-200 bg-white focus:border-emerald-500 focus:ring-emerald-100'}`}
                            required
                          />
                          {formData.password ? (
                            <button
                              type="button"
                              onClick={() => setShowPassword((current) => !current)}
                              className="absolute inset-y-0 right-0 flex items-center px-4 text-slate-500 transition hover:text-slate-700"
                              aria-label={showPassword ? 'Hide password' : 'Show password'}
                            >
                              <EyeIcon open={showPassword} />
                            </button>
                          ) : null}
                        </div>
                        {passwordError ? (
                          <p className="mt-2 text-sm font-semibold text-rose-600">{passwordError}</p>
                        ) : (
                          <p className="mt-2 text-sm text-slate-500">Use more than 12 characters with uppercase, lowercase, and a number or special character.</p>
                        )}
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Confirm Password</label>
                        <div className="relative">
                          <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            name="confirmPassword"
                            value={formData.confirmPassword}
                            onChange={handleChange}
                            placeholder="Re-enter your password"
                            aria-invalid={confirmPasswordError ? 'true' : 'false'}
                            className={`w-full rounded-2xl border px-4 py-3 pr-12 text-sm text-slate-900 outline-none transition focus:ring-4 ${confirmPasswordError ? 'border-rose-400 bg-rose-50 focus:border-rose-500 focus:ring-rose-100' : 'border-slate-200 bg-white focus:border-emerald-500 focus:ring-emerald-100'}`}
                            required
                          />
                          {formData.confirmPassword ? (
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword((current) => !current)}
                              className="absolute inset-y-0 right-0 flex items-center px-4 text-slate-500 transition hover:text-slate-700"
                              aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                            >
                              <EyeIcon open={showConfirmPassword} />
                            </button>
                          ) : null}
                        </div>
                        {confirmPasswordError ? <p className="mt-2 text-sm font-semibold text-rose-600">{confirmPasswordError}</p> : null}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-emerald-100 bg-emerald-50/80 px-4 py-5 sm:px-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Data Privacy Agreement</p>
                    <p className="mt-3 text-sm text-slate-500">
                      Complete the required privacy review first. After that, the reCAPTCHA step will be enabled.
                    </p>
                    <p className="mt-3 text-sm text-slate-500">
                      You can also view the full agreement anytime at{' '}
                      <Link to="/data-privacy-agreement" className="font-semibold text-emerald-700 hover:text-emerald-800">
                        the Data Privacy Agreement page
                      </Link>.
                    </p>

                    {agreementLoading ? (
                      <p className="mt-4 text-sm font-semibold text-emerald-800">Loading the Data Privacy Agreement...</p>
                    ) : agreementError ? (
                      <p className="mt-4 text-sm font-semibold text-rose-700">{agreementError}</p>
                    ) : (
                      <button
                        type="button"
                        onClick={handleConsentIntent}
                        className={`mt-4 flex w-full items-start gap-3 rounded-2xl border px-4 py-4 text-left text-sm transition ${hasAcceptedAgreement ? 'border-emerald-300 bg-white text-slate-700 hover:border-emerald-400' : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/60'}`}
                      >
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${hasAcceptedAgreement ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}>
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="m5 13 4 4L19 7" />
                          </svg>
                        </span>
                        <span>
                          <span className="block font-semibold">
                            I agree to the Data Privacy Agreement
                          </span>
                          <span className="mt-1 block text-slate-500">
                            {hasAcceptedAgreement
                              ? 'Completed. Select this again if you want to reset the consent step before submitting.'
                              : 'Selecting this will open the agreement modal for required review.'}
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-end">
                <div className="order-1 flex flex-col gap-3 sm:flex-row">
                  <Link
                    to="/login"
                    className="rounded-2xl border border-emerald-200 px-5 py-3 text-center text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    Back to Login
                  </Link>
                  <button
                    type="submit"
                    disabled={loading || !canSubmit}
                    className="rounded-2xl bg-emerald-600 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  >
                    {loading ? 'Creating Account...' : 'Register'}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>

      {showAgreementModal && agreement ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/70 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dpa-modal-title"
        >
          <div className="w-full max-w-3xl rounded-[28px] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
            <div className="border-b border-slate-100 px-6 py-5 sm:px-7">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600">Required Review</p>
              <h2 id="dpa-modal-title" className="mt-2 text-2xl font-bold text-slate-900">
                WARDS Data Privacy Agreement
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Scroll to the end of the agreement to enable the close button and complete this step.
              </p>
            </div>

            <div className="px-5 py-5 sm:px-6">
              <DataPrivacyAgreementCard
                agreement={agreement}
                scrollable
                onScroll={handleAgreementScroll}
                containerRef={agreementScrollRef}
                className="border border-slate-200 shadow-none"
                footer={
                  <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    {hasReachedAgreementEnd
                      ? 'You have reached the end of the agreement. You may now close this window to confirm acceptance.'
                      : 'Please continue scrolling until you reach the end of the agreement.'}
                  </div>
                }
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <p className="text-sm text-slate-500">
                {hasReachedAgreementEnd
                  ? 'Review complete. Closing this modal will mark the agreement as accepted.'
                  : ''}
              </p>
              <button
                type="button"
                onClick={handleAgreementModalClose}
                disabled={!hasReachedAgreementEnd}
                className="rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
              >
                Close and Accept
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
