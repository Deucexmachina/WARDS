import { useState, useEffect } from 'react';
import api, { queueAPI } from '../services/api';
import { formatUtc8DateTime } from '../utils/dateTime';
import { printQueueTicket } from '../utils/queueTicketPrint';
import { usePublicLanguage } from '../utils/publicLanguage';

const ViewMyTicket = ({ onClose }) => {
  const [language] = usePublicLanguage();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [selectedService, setSelectedService] = useState('');
  const [addingTransaction, setAddingTransaction] = useState(false);
  const [addTransactionError, setAddTransactionError] = useState(null);
  const [availableServices, setAvailableServices] = useState([]);

  const modalText = language === 'tl'
    ? {
        title: 'Aking Queue Ticket',
        emptyTitle: 'Wala Kang Aktibong Queue Ticket',
        emptyMessage: 'Wala kang aktibong queue ticket sa kasalukuyan.',
        close: 'Isara',
        cancelTicket: 'Kanselahin ang Ticket',
        cancelConfirmTitle: 'Kanselahin ang Queue Ticket?',
        cancelConfirmMessage: 'Sigurado ka bang gusto mong kanselahin ang iyong queue ticket? Hindi na ito mababawi.',
        cancelConfirmBtn: 'Oo, Kanselahin ang Ticket',
        cancelSuccess: 'Matagumpay na nakansela ang iyong queue ticket.',
        cancelError: 'Nabigo ang pagkansela ng iyong ticket. Pakisubukang muli.',
        servingWarning: 'Kasalukuyan kang nagseserbisyo at hindi maaaring kanselahin ang iyong ticket.',
        addTransaction: 'Magdagdag ng Transaksyon',
        addTransactionTitle: 'Magdagdag ng Transaksyon',
        addTransactionMessage: 'Pumili ng serbisyo na nais mong idagdag sa iyong queue.',
        selectService: 'Pumili ng Serbisyo',
        addTransactionBtn: 'Idagdag',
        addTransactionSuccess: 'Matagumpay na naidagdag ang transaksyon.',
        addTransactionError: 'Nabigo ang pagdagdag ng transaksyon. Pakisubukang muli.',
      }
    : {
        title: 'My Queue Ticket',
        emptyTitle: 'No Active Queue Ticket',
        emptyMessage: "You don't have any active queue ticket at the moment.",
        close: 'Close',
        cancelTicket: 'Cancel Ticket',
        cancelConfirmTitle: 'Cancel Queue Ticket?',
        cancelConfirmMessage: 'Are you sure you want to cancel your queue ticket? This action cannot be undone.',
        cancelConfirmBtn: 'Yes, Cancel Ticket',
        cancelSuccess: 'Your queue ticket has been cancelled successfully.',
        cancelError: 'Failed to cancel your ticket. Please try again.',
        servingWarning: 'You are currently being served and cannot cancel your ticket.',
        addTransaction: 'Add Transaction',
        addTransactionTitle: 'Add Transaction',
        addTransactionMessage: 'Select a service you want to add to your queue.',
        selectService: 'Select Service',
        addTransactionBtn: 'Add',
        addTransactionSuccess: 'Transaction added successfully.',
        addTransactionError: 'Failed to add transaction. Please try again.',
      };

  useEffect(() => {
    fetchTicket();
    
    // Set up polling for real-time updates every 10 seconds
    const interval = setInterval(fetchTicket, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchTicket = async () => {
    try {
      setLoading(loading && !ticket); // Only show loading on first load
      setError(null);
      const response = await api.get('/public/queue/my-ticket', { suppressGlobalErrorModal: true });
      if (response.data.has_active_ticket) {
        setTicket(response.data.ticket);
      } else {
        setTicket(null);
      }
    } catch (err) {
      console.error('Failed to fetch ticket:', err);
      if (err.response?.status === 401) {
        setTicket(null);
      } else {
        setError(err.response?.data?.detail || 'Failed to load your ticket. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    printQueueTicket();
  };

  const handleCancelTicket = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await queueAPI.cancelMyTicket();
      setTicket(null);
      setShowCancelConfirm(false);
    } catch (err) {
      const detail = err.response?.data?.detail || modalText.cancelError;
      setCancelError(detail);
    } finally {
      setCancelling(false);
    }
  };

  const handleAddTransaction = async () => {
    if (!selectedService) {
      setAddTransactionError(modalText.selectService);
      return;
    }
    setAddingTransaction(true);
    setAddTransactionError(null);
    try {
      const response = await queueAPI.addTransaction(selectedService);
      setShowAddTransaction(false);
      setSelectedService('');
      // Refresh ticket to show updated status
      await fetchTicket();
      // Show success message (could use a toast or alert)
      alert(modalText.addTransactionSuccess);
    } catch (err) {
      const detail = err.response?.data?.detail || modalText.addTransactionError;
      setAddTransactionError(detail);
    } finally {
      setAddingTransaction(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return formatUtc8DateTime(dateString, 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getStatusColor = (status) => {
    const statusLower = (status || '').toLowerCase();
    const colors = {
      'waiting': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'pending': 'bg-gray-100 text-gray-800 border-gray-200',
      'called': 'bg-blue-100 text-blue-800 border-blue-200',
      'serving': 'bg-green-100 text-green-800 border-green-200',
      'completed': 'bg-emerald-100 text-emerald-800 border-emerald-200',
      'skipped': 'bg-orange-100 text-orange-800 border-orange-200',
      'cancelled': 'bg-red-100 text-red-800 border-red-200',
    };
    return colors[statusLower] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-2xl">
          <div className="flex items-center justify-center py-12">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
          <div className="border-b border-slate-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-primary">{modalText.title}</h3>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                aria-label={modalText.close}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
          </div>
          <div className="px-6 py-12 text-center">
            <svg className="mx-auto h-16 w-16 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <p className="mt-4 text-slate-600">{error}</p>
            <button
              onClick={onClose}
              className="mt-6 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-secondary transition"
            >
              {modalText.close}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
          <div className="border-b border-slate-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-primary">{modalText.title}</h3>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                aria-label={modalText.close}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
          </div>
          <div className="px-6 py-12 text-center">
            <svg className="mx-auto h-16 w-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <h4 className="mt-4 text-lg font-semibold text-slate-700">{modalText.emptyTitle}</h4>
            <p className="mt-2 text-sm text-slate-500">
              {modalText.emptyMessage}
            </p>
            <button
              onClick={onClose}
              className="mt-6 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-secondary transition"
            >
              {modalText.close}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="border-b border-slate-200 bg-white px-6 py-4 print:hidden sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-primary">{modalText.title}</h3>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              aria-label={modalText.close}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Ticket Content */}
        <div className="px-6 py-6" data-print-ticket>
          {/* Queue Number - Large Display */}
          <div className="mb-6 rounded-2xl border-2 border-primary bg-gradient-to-br from-primary/5 to-secondary/5 p-6 text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Queue Number</p>
            <p className="mt-2 text-5xl font-bold text-primary">{ticket.queue_number}</p>
            <div className={`mt-4 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold ${getStatusColor(ticket.status)}`}>
              <span className="h-2 w-2 rounded-full bg-current animate-pulse"></span>
              {ticket.status}
            </div>
          </div>

          {/* Ticket Details */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Branch</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{ticket.branch_name}</p>
                {ticket.branch_address && (
                  <p className="mt-0.5 text-xs text-slate-500">{ticket.branch_address}</p>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service Type</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{ticket.service_type}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Queue Type</p>
                <p className="mt-1 text-sm font-semibold capitalize text-slate-800">{ticket.queue_type}</p>
              </div>
              {ticket.position > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Position in Queue</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">#{ticket.position}</p>
                </div>
              )}
            </div>

            {ticket.estimated_wait_time != null && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Estimated Wait Time</p>
                <p className="mt-1 text-sm font-semibold text-blue-900">{ticket.estimated_wait_time} minutes</p>
              </div>
            )}

            {ticket.appointment_time && (
              <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">Appointment Time</p>
                <p className="mt-1 text-sm font-semibold text-purple-900">{formatDate(ticket.appointment_time)}</p>
              </div>
            )}

            {ticket.recommended_arrival && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Recommended Arrival</p>
                <p className="mt-1 text-sm font-semibold text-green-900">{formatDate(ticket.recommended_arrival)}</p>
              </div>
            )}

            {(ticket.linked_receipt_requests || []).length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Linked Request Receipt Transactions</p>
                <div className="mt-3 space-y-3">
                  {ticket.linked_receipt_requests.map((request) => (
                    <div key={request.request_id} className="rounded-lg border border-amber-100 bg-white px-3 py-3">
                      <p className="text-sm font-semibold text-slate-900">{request.request_id}</p>
                      <p className="mt-1 text-sm text-slate-700">{request.tax_type} · {request.request_type}</p>
                      <p className="mt-1 text-xs text-slate-500">Status: {request.status}</p>
                      <p className="mt-1 text-xs text-slate-500">Payment: {request.payment_status || (request.fee_paid ? 'Verified' : 'Pending')}</p>
                      <p className="mt-1 text-xs text-slate-500">Fee paid: {request.fee_paid ? 'Yes' : 'No'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Issued On</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{formatDate(ticket.created_at)}</p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 print:hidden">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              onClick={() => { setShowCancelConfirm(true); setCancelError(null); }}
              disabled={cancelling || (ticket.status || '').toLowerCase() === 'serving'}
              className="rounded-lg border border-red-300 bg-white px-5 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {modalText.cancelTicket}
            </button>
            <button
              onClick={() => { setShowAddTransaction(true); setSelectedService(''); setAddTransactionError(null); }}
              disabled={(ticket.status || '').toLowerCase() === 'serving' || (ticket.status || '').toLowerCase() === 'called'}
              className="rounded-lg border border-primary bg-white px-5 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {modalText.addTransaction}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {modalText.close}
            </button>
            <button
              onClick={handlePrint}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-secondary"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path>
              </svg>
              Print Ticket
            </button>
          </div>
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-bold text-red-600">{modalText.cancelConfirmTitle}</h3>
            </div>
            <div className="px-6 py-6">
              <p className="text-sm text-slate-600">{modalText.cancelConfirmMessage}</p>
              {cancelError && (
                <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{cancelError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                onClick={() => { setShowCancelConfirm(false); setCancelError(null); }}
                disabled={cancelling}
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {modalText.close}
              </button>
              <button
                onClick={handleCancelTicket}
                disabled={cancelling}
                className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelling ? '...' : modalText.cancelConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Transaction Modal */}
      {showAddTransaction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-bold text-primary">{modalText.addTransactionTitle}</h3>
            </div>
            <div className="px-6 py-6">
              <p className="text-sm text-slate-600">{modalText.addTransactionMessage}</p>
              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">{modalText.selectService}</span>
                <select
                  value={selectedService}
                  onChange={(e) => { setSelectedService(e.target.value); setAddTransactionError(null); }}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                >
                  <option value="">-- Select a service --</option>
                  <option value="RPT">RPT (Real Property Tax)</option>
                  <option value="BT">BT (Business Tax)</option>
                  <option value="Payment">Payment</option>
                  <option value="Certificate">Certificate</option>
                  <option value="Assessment">Assessment</option>
                </select>
              </label>
              {addTransactionError && (
                <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{addTransactionError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                onClick={() => { setShowAddTransaction(false); setSelectedService(''); setAddTransactionError(null); }}
                disabled={addingTransaction}
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {modalText.close}
              </button>
              <button
                onClick={handleAddTransaction}
                disabled={addingTransaction || !selectedService}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {addingTransaction ? '...' : modalText.addTransactionBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViewMyTicket;
