import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = 'http://localhost:8000';
const PENDING_VERIFICATION_STORAGE_KEY = 'pendingCitizenVerification';
const DEFAULT_RESEND_SECONDS = 120;

const maskEmail = (email) => {
  const [localPart = '', domain = ''] = String(email || '').split('@');
  if (!localPart || !domain) {
    return email;
  }

  if (localPart.length <= 2) {
    return `${localPart[0] || ''}*@${domain}`;
  }

  return `${localPart.slice(0, 2)}${'*'.repeat(Math.max(localPart.length - 2, 1))}@${domain}`;
};

const readStoredVerification = () => {
  try {
    const raw = sessionStorage.getItem(PENDING_VERIFICATION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeStoredVerification = (payload) => {
  sessionStorage.setItem(PENDING_VERIFICATION_STORAGE_KEY, JSON.stringify(payload));
};

const clearStoredVerification = () => {
  sessionStorage.removeItem(PENDING_VERIFICATION_STORAGE_KEY);
};

function VerifyCitizenEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const storedVerification = readStoredVerification();
  const initialVerification = location.state || storedVerification || {};

  const [email, setEmail] = useState(initialVerification.email || '');
  const [fullName] = useState(initialVerification.fullName || '');
  const [source, setSource] = useState(initialVerification.source || 'register');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(
    initialVerification.message || 'Enter the verification code sent to your email to activate your account.',
  );
  const [countdown, setCountdown] = useState(
    Number(initialVerification.resendAvailableInSeconds || DEFAULT_RESEND_SECONDS),
  );

  const maskedEmail = useMemo(() => maskEmail(email), [email]);

  useEffect(() => {
    if (!email) {
      return;
    }

    writeStoredVerification({
      email,
      fullName,
      source,
      message,
      resendAvailableInSeconds: countdown,
    });
  }, [countdown, email, fullName, message, source]);

  useEffect(() => {
    if (!email) {
      navigate('/user/register', { replace: true });
    }
  }, [email, navigate]);

  useEffect(() => {
    if (source !== 'login' || !email) {
      return;
    }

    let cancelled = false;

    const requestCode = async () => {
      setResendLoading(true);
      setError('');

      try {
        const response = await axios.post(`${API_URL}/api/auth/unified/verification/request`, {
          email,
        });

        if (cancelled) {
          return;
        }

        setMessage(response.data.message || 'A new verification code was sent to your email.');
        setCountdown(Number(response.data.resend_available_in_seconds || DEFAULT_RESEND_SECONDS));
        setSource('verify');
      } catch (err) {
        if (cancelled) {
          return;
        }

        const detail = err.response?.data?.detail;
        const detailMessage = typeof detail === 'string' ? detail : 'Unable to send a verification code right now.';
        const secondsMatch = detailMessage.match(/(\d+)\s+seconds?/i);
        if (secondsMatch) {
          setCountdown(Number(secondsMatch[1]));
        }
        setMessage(detailMessage);
      } finally {
        if (!cancelled) {
          setResendLoading(false);
        }
      }
    };

    requestCode();

    return () => {
      cancelled = true;
    };
  }, [email, source]);

  useEffect(() => {
    if (countdown <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setCountdown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [countdown]);

  const handleVerify = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/api/auth/unified/verification/confirm`, {
        email,
        code,
      });

      clearStoredVerification();
      sessionStorage.setItem('loginMessage', response.data.message || 'Email verified. You can now log in.');
      sessionStorage.setItem('loginMessageType', 'success');
      navigate('/login?portal=public', { replace: true });
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Verification failed. Please check your code and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    setError('');

    try {
      const response = await axios.post(`${API_URL}/api/auth/unified/verification/request`, {
        email,
      });

      setMessage(response.data.message || 'A new verification code was sent to your email.');
      setCountdown(Number(response.data.resend_available_in_seconds || DEFAULT_RESEND_SECONDS));
      setCode('');
    } catch (err) {
      const detail = err.response?.data?.detail;
      const detailMessage = typeof detail === 'string' ? detail : 'Unable to resend the verification code right now.';
      const secondsMatch = detailMessage.match(/(\d+)\s+seconds?/i);
      if (secondsMatch) {
        setCountdown(Number(secondsMatch[1]));
      }
      setError(detailMessage);
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#2563eb_0%,#1d4ed8_45%,#0f172a_100%)] flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-[28px] bg-white/95 shadow-[0_30px_80px_rgba(15,23,42,0.25)] backdrop-blur p-8 md:p-10">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 11c0 .552-.448 1-1 1s-1-.448-1-1 .448-1 1-1 1 .448 1 1zm0 0V8m0 8h.01M5.07 19h13.86c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.338 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Verify Your Email</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {fullName ? `Hi ${fullName}, ` : ''}
            we sent a 6-digit verification code to <span className="font-semibold text-slate-800">{maskedEmail}</span>.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm text-blue-800">
          <p className="font-semibold">Waiting for your code</p>
          <p className="mt-1 leading-6">{message}</p>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleVerify} className="mt-8 space-y-5">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">6-Digit Verification Code</label>
            <input
              type="text"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                setError('');
              }}
              placeholder="000000"
              maxLength={6}
              autoComplete="one-time-code"
              className="w-full rounded-2xl border-2 border-slate-200 px-4 py-4 text-center font-mono text-3xl tracking-[0.45em] text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              required
            />
            <p className="mt-2 text-xs text-slate-500">The code expires after 10 minutes.</p>
          </div>

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full rounded-2xl bg-blue-600 py-4 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Verify Email'}
          </button>
        </form>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-semibold text-slate-700">Need another code?</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            {countdown > 0
              ? `You can request a new code in ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}.`
              : 'You can request a new verification code now.'}
          </p>
          <button
            type="button"
            onClick={handleResend}
            disabled={resendLoading || countdown > 0}
            className="mt-4 w-full rounded-2xl border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resendLoading ? 'Sending code...' : countdown > 0 ? 'Resend Locked' : 'Send New Code'}
          </button>
        </div>

        <div className="mt-6 text-center text-sm text-slate-600">
          <p>
            Already verified?{' '}
            <Link to="/login?portal=public" className="font-semibold text-blue-700 hover:text-blue-800">
              Go to login
            </Link>
          </p>
          <button
            type="button"
            onClick={() => {
              clearStoredVerification();
              navigate('/user/register');
            }}
            className="mt-3 font-semibold text-slate-500 transition hover:text-slate-700"
          >
            Back to registration
          </button>
        </div>
      </div>
    </div>
  );
}

export default VerifyCitizenEmail;
