import { useEffect, useState } from 'react';
import axios from 'axios';

import DataPrivacyAgreementCard from '../../components/DataPrivacyAgreementCard';

import { API_HOST } from '../../services/api';

const DataPrivacyAgreement = () => {
  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    const loadAgreement = async () => {
      try {
        const response = await axios.get(`${API_HOST}/api/privacy/data-privacy-agreement`);
        if (isMounted) {
          setAgreement(response.data);
        }
      } catch (requestError) {
        if (isMounted) {
          setError('Unable to load the Data Privacy Agreement right now.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadAgreement();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-[radial-gradient(circle_at_top,#dcfce7_0%,#f8fafc_38%,#f0fdf4_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">WARDS Public Portal</p>
          <h1 className="mt-3 text-4xl font-bold text-slate-900">Data Privacy Agreement</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Review how WARDS collects, uses, stores, and protects citizen information under Republic Act No. 10173.
          </p>
        </div>

        {loading ? (
          <div className="rounded-[28px] border border-emerald-100 bg-white p-8 text-center text-slate-500 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            Loading agreement...
          </div>
        ) : error ? (
          <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : (
          <DataPrivacyAgreementCard agreement={agreement} />
        )}
      </div>
    </div>
  );
};

export default DataPrivacyAgreement;
