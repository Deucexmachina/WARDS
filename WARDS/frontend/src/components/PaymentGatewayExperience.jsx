import { useEffect, useMemo, useState } from 'react';
import creditCardLogo from '../assets/payment/credit-card-logo.png';
import gcashLogo from '../assets/payment/gcash-logo.jpeg';
import mayaLogo from '../assets/payment/maya-logo.jpeg';

export const PAYMENT_METHOD_OPTIONS = [
  {
    id: 'gcash',
    label: 'GCash',
    short: 'G',
    logo: gcashLogo,
    description: 'Wallet authorization',
    accent: 'bg-[#0f2f5f]',
    border: 'border-[#0f2f5f]',
    soft: 'bg-[#f3f7fc]',
    text: 'text-[#0f2f5f]',
  },
  {
    id: 'maya',
    label: 'Maya',
    short: 'M',
    logo: mayaLogo,
    description: 'Wallet authorization',
    accent: 'bg-[#0f2f5f]',
    border: 'border-[#0f2f5f]',
    soft: 'bg-[#f3f7fc]',
    text: 'text-[#0f2f5f]',
  },
  {
    id: 'credit_card',
    label: 'Credit Card',
    short: 'CC',
    logo: creditCardLogo,
    description: 'Secure card checkout',
    accent: 'bg-[#0f2f5f]',
    border: 'border-[#0f2f5f]',
    soft: 'bg-[#f3f7fc]',
    text: 'text-[#0f2f5f]',
  },
];

// Kept for backward compatibility with older payment pages that may import it.
export const BANK_OPTIONS = [];

const PH_MOBILE_PATTERN = /^(?:\+63|63|0)9\d{9}$/;
const NAME_PATTERN = /^[A-Za-z ]+$/;

const normalizeMobile = (value) => String(value || '').replace(/[\s()-]/g, '');
const validateEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const formatCurrency = (amount) =>
  `PHP ${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FieldError = ({ message }) => (
  message ? <p className="mt-2 text-xs font-semibold text-rose-600">{message}</p> : null
);

const DetailRow = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 text-sm last:border-b-0">
    <span className="text-slate-500">{label}</span>
    <span className="text-right font-bold text-slate-950">{value || 'N/A'}</span>
  </div>
);

const StepPill = ({ active, label, number }) => (
  <span
    className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] ${
      active ? 'bg-[#0f2f5f] text-white' : 'bg-slate-100 text-slate-400'
    }`}
  >
    <span
      className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
        active ? 'bg-white/20 text-white' : 'bg-white text-slate-400'
      }`}
    >
      {number}
    </span>
    {label}
  </span>
);

const PaymentGatewayExperience = ({
  amount,
  bankCode = '',
  className = '',
  customer = {},
  disabled = false,
  method = 'gcash',
  onContinue,
  onCustomerChange,
  onMethodChange,
  processing = false,
  referenceNumber,
  title = 'Payment Method',
}) => {
  const [step, setStep] = useState('details');
  const [details, setDetails] = useState({
    name: customer.name || '',
    email: customer.email || '',
    mobile: customer.mobile || '',
  });
  const [errors, setErrors] = useState({});

  const effectiveMethod = method === 'card' ? 'credit_card' : method || 'gcash';
  const selectedMethod = useMemo(
    () => PAYMENT_METHOD_OPTIONS.find((option) => option.id === effectiveMethod) || PAYMENT_METHOD_OPTIONS[0],
    [effectiveMethod],
  );
  const needsMobile = selectedMethod.id === 'gcash' || selectedMethod.id === 'maya';
  const needsEmail = selectedMethod.id === 'credit_card';

  useEffect(() => {
    setDetails((current) => ({
      ...current,
      name: customer.name || current.name,
      email: customer.email || current.email,
      mobile: customer.mobile || current.mobile,
    }));
  }, [customer.email, customer.mobile, customer.name]);

  useEffect(() => {
    setStep('details');
    setErrors({});
  }, [method, bankCode]);

  const updateDetail = (field, value) => {
    setDetails((current) => {
      const next = { ...current, [field]: value };
      onCustomerChange?.({
        name: next.name,
        email: next.email,
        mobile: next.mobile,
      });
      return next;
    });
    setErrors((current) => ({ ...current, [field]: '' }));
  };

  const selectMethod = (option) => {
    onMethodChange?.(option.id === 'credit_card' ? 'card' : option.id);
    setStep('details');
    setErrors({});
  };

  const validate = () => {
    const nextErrors = {};
    const name = details.name.trim();
    const email = details.email.trim();
    const mobile = normalizeMobile(details.mobile);

    if (!name) {
      nextErrors.name = 'Name is required.';
    } else if (!NAME_PATTERN.test(name)) {
      nextErrors.name = 'Name must contain letters and spaces only.';
    }

    if (needsMobile) {
      if (!mobile) {
        nextErrors.mobile = 'Mobile number is required.';
      } else if (!PH_MOBILE_PATTERN.test(mobile)) {
        nextErrors.mobile = 'Enter a valid Philippine mobile number.';
      }
    }

    if (needsEmail) {
      if (!email) {
        nextErrors.email = 'Email address is required.';
      } else if (!validateEmail(email)) {
        nextErrors.email = 'Enter a valid email address.';
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleReview = () => {
    if (!validate()) return;
    setStep('review');
  };

  const handleFinalSubmit = async () => {
    await onContinue?.({
      method: selectedMethod.id === 'credit_card' ? 'card' : selectedMethod.id,
      bankCode,
      customer: {
        name: details.name.trim(),
        email: details.email.trim(),
        mobile: normalizeMobile(details.mobile),
      },
    });
  };

  return (
    <div className={`overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.10)] ${className}`}>
      <div className="grid min-h-[520px] lg:grid-cols-[0.92fr_1.08fr]">
        <aside className="relative overflow-hidden bg-gradient-to-br from-[#061a33] via-[#0f2f5f] to-[#123f8f] p-6 text-white sm:p-8">
          <div className="absolute -left-16 -top-16 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-20 right-0 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/70">WARDS Checkout</p>
            <h3 className="mt-4 text-2xl font-black leading-tight">{title}</h3>
            {referenceNumber ? (
              <p className="mt-2 break-all text-xs font-bold uppercase tracking-[0.16em] text-white/70">
                Reference {referenceNumber}
              </p>
            ) : null}

            <div className="mt-10">
              <p className="text-sm font-semibold text-white/75">Amount to pay</p>
              <p className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">{formatCurrency(amount).replace('PHP ', 'PHP ')}</p>
            </div>

            <div className="mt-10 space-y-4 border-t border-white/25 pt-6">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-white/75">Subtotal</span>
                <span className="font-bold">{formatCurrency(amount)}</span>
              </div>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-white/75">Fees</span>
                <span className="font-bold">Free</span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-white/25 pt-4 text-base">
                <span className="font-bold">Total due today</span>
                <span className="font-black">{formatCurrency(amount)}</span>
              </div>
            </div>

            <div className="mt-10 rounded-3xl bg-white/15 p-4 backdrop-blur">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Selected Method</p>
              <div className="mt-3 flex items-center gap-3">
                {selectedMethod.logo ? (
                  <img
                    src={selectedMethod.logo}
                    alt={`${selectedMethod.label} logo`}
                    className="h-10 w-10 rounded-2xl object-cover shadow-sm"
                  />
                ) : (
                  <span className={`grid h-10 w-10 place-items-center rounded-2xl text-sm font-black text-white ${selectedMethod.accent}`}>
                    {selectedMethod.short}
                  </span>
                )}
                <div>
                  <p className="font-black">{selectedMethod.label}</p>
                  <p className="text-xs text-white/70">{selectedMethod.description}</p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="bg-white p-6 sm:p-8">
          <div className="mb-6 flex flex-wrap gap-2">
            <StepPill active number="1" label="Method" />
            <StepPill active={step === 'details' || step === 'review'} number="2" label="Details" />
            <StepPill active={step === 'review'} number="3" label="Confirm" />
          </div>

          {step === 'details' ? (
            <>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.16em] text-slate-400">Payment method</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {PAYMENT_METHOD_OPTIONS.map((option) => {
                    const selected = option.id === selectedMethod.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={disabled || processing}
                        onClick={() => selectMethod(option)}
                        className={`group rounded-3xl border p-4 text-left transition ${
                          selected
                            ? `${option.border} bg-white shadow-[0_14px_30px_rgba(15,23,42,0.12)]`
                            : 'border-slate-200 bg-slate-50 hover:border-slate-400 hover:bg-white'
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          {option.logo ? (
                            <img
                              src={option.logo}
                              alt={`${option.label} logo`}
                              className="h-10 w-10 rounded-2xl object-cover shadow-sm"
                            />
                          ) : (
                            <span className={`grid h-10 w-10 place-items-center rounded-2xl text-xs font-black text-white ${option.accent}`}>
                              {option.short}
                            </span>
                          )}
                          <span
                            className={`h-3 w-3 rounded-full border ${
                              selected ? `${option.accent} border-transparent` : 'border-slate-300 bg-white'
                            }`}
                          />
                        </div>
                        <p className="mt-4 text-sm font-black text-slate-950">{option.label}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{option.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={`mt-7 rounded-[28px] border ${selectedMethod.border} ${selectedMethod.soft} p-1`}>
                <div className="rounded-[24px] bg-white p-5 shadow-[0_12px_35px_rgba(15,23,42,0.06)]">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <p className={`text-xs font-black uppercase tracking-[0.18em] ${selectedMethod.text}`}>{selectedMethod.label} details</p>
                      <p className="mt-2 text-sm leading-5 text-slate-500">
                        {selectedMethod.id === 'credit_card'
                          ? 'WARDS verifies payer details first. PayMongo securely collects the card number, expiry, and CVC on the final checkout page.'
                          : `Enter the payer details for ${selectedMethod.label}. WARDS validates these before opening PayMongo for final authorization.`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-2xl px-3 py-2 text-xs font-black text-white ${selectedMethod.accent}`}>PayMongo</span>
                  </div>

                  <div className="grid gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700">
                        {selectedMethod.id === 'credit_card' ? 'Cardholder Name' : 'Name'}
                      </label>
                      <input
                        value={details.name}
                        onChange={(event) => updateDetail('name', event.target.value)}
                        placeholder="Juan Dela Cruz"
                        disabled={disabled || processing}
                        className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-4 ${
                          errors.name ? 'border-rose-400 bg-rose-50 focus:ring-rose-100' : 'border-slate-300 bg-white focus:ring-sky-100'
                        }`}
                      />
                      <FieldError message={errors.name} />
                    </div>

                    {needsEmail ? (
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
                        <input
                          type="email"
                          value={details.email}
                          onChange={(event) => updateDetail('email', event.target.value)}
                          placeholder="email@example.com"
                          disabled={disabled || processing}
                          className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-4 ${
                            errors.email ? 'border-rose-400 bg-rose-50 focus:ring-rose-100' : 'border-slate-300 bg-white focus:ring-sky-100'
                          }`}
                        />
                        <FieldError message={errors.email} />
                      </div>
                    ) : null}

                    {needsMobile ? (
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">Mobile Number</label>
                        <input
                          type="tel"
                          value={details.mobile}
                          onChange={(event) => updateDetail('mobile', event.target.value)}
                          placeholder="09XXXXXXXXX"
                          disabled={disabled || processing}
                          className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-4 ${
                            errors.mobile ? 'border-rose-400 bg-rose-50 focus:ring-rose-100' : 'border-slate-300 bg-white focus:ring-sky-100'
                          }`}
                        />
                        <FieldError message={errors.mobile} />
                      </div>
                    ) : null}
                  </div>

                  {selectedMethod.id === 'credit_card' ? (
                    <div className="mt-5 rounded-3xl border border-indigo-100 bg-indigo-50 p-4">
                      <p className="text-sm font-black text-slate-950">Secure card entry happens on PayMongo.</p>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        This keeps WARDS out of raw card data handling while still giving users a clean review step before payment.
                      </p>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={handleReview}
                    disabled={disabled || processing}
                    className={`mt-6 w-full rounded-2xl px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 ${selectedMethod.accent}`}
                  >
                    Review Payment
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Transaction Summary</p>
                <h4 className="mt-2 text-3xl font-black text-slate-950">{formatCurrency(amount)}</h4>
                <div className="mt-5 rounded-2xl bg-white px-4">
                  <DetailRow label="Payment Method" value={selectedMethod.label} />
                  <DetailRow label="Name" value={details.name} />
                  {needsEmail ? <DetailRow label="Email" value={details.email} /> : null}
                  {needsMobile ? <DetailRow label="Mobile" value={normalizeMobile(details.mobile)} /> : null}
                  {selectedMethod.id === 'credit_card' ? <DetailRow label="Card Entry" value="PayMongo secure checkout" /> : null}
                  {referenceNumber ? <DetailRow label="Reference" value={referenceNumber} /> : null}
                </div>
                <p className="mt-4 text-xs leading-5 text-slate-500">
                  After confirming, WARDS will send the transaction to PayMongo for the final result: success, failed, cancelled, or pending.
                </p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[0.7fr_1.3fr]">
                <button
                  type="button"
                  onClick={() => setStep('details')}
                  disabled={processing}
                  className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleFinalSubmit}
                  disabled={disabled || processing}
                  className={`rounded-2xl px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 ${selectedMethod.accent}`}
                >
                  {processing ? 'Opening PayMongo...' : 'Confirm And Process'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <p className="border-t border-slate-100 bg-white py-4 text-center text-sm text-slate-500">
        Powered by <span className="font-black text-slate-600">PayMongo</span>
      </p>
    </div>
  );
};

export default PaymentGatewayExperience;
