import { useEffect, useMemo, useState } from 'react';
import { taxpayerAccountAPI, queueAPI } from '../../services/api';
import { getEmailValidationMessage } from '../../utils/validation';

const DEFAULT_PROFILE = {
  full_name: '',
  email: '',
  mobile_number: '',
  address: '',
  taxpayer_type: 'Individual',
  tin: '',
};

const DEFAULT_IDENTIFIER_FORM = {
  submission_type: 'RPT',
  taxpayer_type: 'Individual',
  tdn: '',
  mayor_permit_number: '',
  sec_dti_cda_number: '',
  supporting_file: null,
};

const statusTone = {
  'Pending Verification': 'bg-amber-100 text-amber-800 border-amber-200',
  Verified: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  Rejected: 'bg-rose-100 text-rose-800 border-rose-200',
  Active: 'bg-blue-100 text-blue-800 border-blue-200',
  Inactive: 'bg-slate-100 text-slate-700 border-slate-200',
};

const formatCurrency = (value) =>
  `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatTimestamp = (value) =>
  value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'N/A';

const isProfileReady = (profile) =>
  Boolean(
    profile?.full_name?.trim() &&
    profile?.email?.trim() &&
    profile?.mobile_number?.trim() &&
    profile?.address?.trim() &&
    profile?.taxpayer_type?.trim()
  );

const AccountManagement = () => {
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
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

  const loadAccount = async () => {
    try {
      setLoading(true);
      const response = await taxpayerAccountAPI.getAccount();
      const nextProfile = response.data?.profile || DEFAULT_PROFILE;
      setProfile({
        ...DEFAULT_PROFILE,
        ...nextProfile,
        mobile_number: nextProfile.mobile_number || '',
        tin: nextProfile.tin || '',
      });
      setIsProfileLocked(isProfileReady(nextProfile));
      setIdentifierForm((current) => ({
        ...current,
        taxpayer_type: nextProfile.taxpayer_type || 'Individual',
      }));
      setSubmissions(response.data?.submissions || []);
      setAssessments(response.data?.assessments || []);
      
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

  const rptAssessments = useMemo(() => assessments.filter((item) => item.tax_type === 'RPT'), [assessments]);
  const btAssessments = useMemo(() => assessments.filter((item) => item.tax_type === 'BT'), [assessments]);

  const handleProfileChange = (event) => {
    const { name, value } = event.target;
    setProfile((current) => ({ ...current, [name]: value }));
    if (name === 'email') {
      setEmailError(getEmailValidationMessage(value));
    }
    if (name === 'taxpayer_type') {
      setIdentifierForm((current) => ({ ...current, taxpayer_type: value }));
    }
    setMessage('');
    setError('');
  };

  const handleIdentifierChange = (event) => {
    const { name, value, files } = event.target;
    setIdentifierForm((current) => ({
      ...current,
      [name]: name === 'supporting_file' ? files?.[0] || null : value,
      taxpayer_type: name === 'submission_type' && value === 'RPT' ? profile.taxpayer_type : current.taxpayer_type,
    }));
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

    try {
      setSavingProfile(true);
      const response = await taxpayerAccountAPI.updateProfile(profile);
      const nextProfile = response.data?.profile || profile;
      setProfile((current) => ({ ...current, ...nextProfile, mobile_number: nextProfile.mobile_number || current.mobile_number }));
      const storedUser = JSON.parse(localStorage.getItem('user') || 'null');
      if (storedUser) {
        localStorage.setItem('user', JSON.stringify({
          ...storedUser,
          full_name: nextProfile.full_name,
          email: nextProfile.email,
          contact_number: nextProfile.mobile_number,
          address: nextProfile.address,
          taxpayer_type: nextProfile.taxpayer_type,
          tin: nextProfile.tin,
        }));
      }
      setMessage(response.data?.message || 'Profile updated successfully.');
      setError('');
      setIsProfileLocked(true);
      await loadAccount();
    } catch (saveError) {
      setError(saveError.response?.data?.detail || 'Failed to update taxpayer profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSubmitIdentifier = async (event) => {
    event.preventDefault();
    if (!identifierForm.supporting_file) {
      setError('Upload a supporting document before submitting an identifier.');
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
                    type={isProfileLocked ? 'button' : 'submit'}
                    onClick={isProfileLocked ? handleEditProfile : undefined}
                    disabled={savingProfile}
                    className="rounded-full bg-[#0f5b83] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c4d6f] disabled:opacity-60"
                  >
                    {savingProfile ? 'Saving...' : isProfileLocked ? 'Edit Profile' : 'Save Profile'}
                  </button>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Full Name</span>
                    <input name="full_name" value={profile.full_name} onChange={handleProfileChange} disabled={isProfileLocked} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10" required />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Email Address</span>
                    <input name="email" type="email" value={profile.email} onChange={handleProfileChange} disabled={isProfileLocked} className={`w-full rounded-2xl border px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:ring-2 focus:ring-[#0f5b83]/10 ${emailError ? 'border-rose-400 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-[#0f5b83]'}`} required />
                    {emailError ? <span className="mt-2 block text-xs font-medium text-rose-600">{emailError}</span> : null}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Mobile Number</span>
                    <input name="mobile_number" value={profile.mobile_number} onChange={handleProfileChange} disabled={isProfileLocked} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10" placeholder="09XXXXXXXXX" required />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Taxpayer Type</span>
                    <select name="taxpayer_type" value={profile.taxpayer_type} onChange={handleProfileChange} disabled={isProfileLocked} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10">
                      <option value="Individual">Individual</option>
                      <option value="Business Owner">Business Owner</option>
                    </select>
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Address</span>
                    <input name="address" value={profile.address} onChange={handleProfileChange} disabled={isProfileLocked} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10" required />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Tax Identification Number (TIN)</span>
                    <input name="tin" value={profile.tin} onChange={handleProfileChange} disabled={isProfileLocked} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10" placeholder="Optional" />
                  </label>
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
                      <select name="submission_type" value={identifierForm.submission_type} onChange={handleIdentifierChange} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10">
                        <option value="RPT">Real Property Tax (RPT)</option>
                        <option value="BT">Business Tax (BT)</option>
                      </select>
                    </label>

                    {identifierForm.submission_type === 'RPT' ? (
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-slate-700">Tax Declaration Number (TDN)</span>
                        <input name="tdn" value={identifierForm.tdn} onChange={handleIdentifierChange} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm uppercase outline-none transition focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10" required />
                      </label>
                    ) : (
                      <>
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">Mayor&apos;s Permit Number</span>
                          <input name="mayor_permit_number" value={identifierForm.mayor_permit_number} onChange={handleIdentifierChange} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm uppercase outline-none transition focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10" required={profile.taxpayer_type === 'Business Owner'} />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-sm font-semibold text-slate-700">SEC/DTI/CDA Registration Number</span>
                          <input name="sec_dti_cda_number" value={identifierForm.sec_dti_cda_number} onChange={handleIdentifierChange} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm uppercase outline-none transition focus:border-[#0f5b83] focus:ring-2 focus:ring-[#0f5b83]/10" required={profile.taxpayer_type === 'Business Owner'} />
                        </label>
                      </>
                    )}

                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">Supporting File</span>
                      <input type="file" name="supporting_file" onChange={handleIdentifierChange} accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm" required />
                      <span className="mt-2 block text-xs text-slate-500">Accepted formats: PDF, PNG, JPG, JPEG, DOC, DOCX. Maximum 10MB.</span>
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
    </section>
  );
};

export default AccountManagement;
