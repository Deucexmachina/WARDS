import { formatUtc8DateTime } from './dateTime';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDisplayValue = (value, fallback = 'N/A') => {
  const normalized = String(value ?? '').trim();
  return normalized ? escapeHtml(normalized) : fallback;
};

const formatWaitTime = (minutes) => {
  const numericMinutes = Number(minutes);
  if (!Number.isFinite(numericMinutes) || numericMinutes < 0) {
    return 'N/A';
  }
  return `${Math.round(numericMinutes)} min`;
};

const buildTicketMarkup = ({
  title,
  queueNumber,
  branchName,
  queueType,
  serviceType,
  appointmentTime,
  recommendedArrival,
  estimatedWaitTime,
  createdAt,
  taxpayerName,
  contactNumber,
  message,
}) => `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)} - ${escapeHtml(queueNumber)}</title>
      <style>
        :root {
          color-scheme: light;
          --border: #dbe3ee;
          --border-strong: #bfdbfe;
          --ink: #0f172a;
          --muted: #64748b;
          --panel: #ffffff;
          --panel-soft: #f8fafc;
          --accent: #1d4ed8;
          --accent-soft: #eff6ff;
          --note-bg: #fefce8;
          --note-border: #fde68a;
          --note-text: #854d0e;
        }

        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #eef2f7; color: var(--ink); font-family: "Segoe UI", Arial, sans-serif; }
        body { padding: 12px; }
        .sheet {
          width: min(100%, 720px);
          margin: 0 auto;
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 20px;
        }
        .header {
          padding-bottom: 12px;
          margin-bottom: 16px;
          border-bottom: 2px solid var(--accent);
        }
        .title {
          margin: 0;
          font-size: 24px;
          font-weight: 800;
        }
        .subtitle {
          margin: 4px 0 0;
          font-size: 13px;
          color: var(--muted);
        }
        .ticket-number {
          margin-bottom: 16px;
          padding: 16px;
          border: 1px solid var(--border-strong);
          border-radius: 16px;
          background: var(--accent-soft);
          text-align: center;
        }
        .ticket-number-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .ticket-number-value {
          margin-top: 8px;
          font-size: 34px;
          line-height: 1.1;
          font-weight: 800;
          color: var(--accent);
          word-break: break-word;
        }
        .details {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .detail {
          min-width: 0;
          padding: 12px;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--panel-soft);
        }
        .detail-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .detail-value {
          margin-top: 6px;
          font-size: 15px;
          line-height: 1.4;
          font-weight: 600;
          color: var(--ink);
          word-break: break-word;
        }
        .note {
          margin-top: 14px;
          padding: 12px 14px;
          border: 1px solid var(--note-border);
          border-radius: 12px;
          background: var(--note-bg);
          color: var(--note-text);
          font-size: 13px;
          line-height: 1.5;
          white-space: pre-wrap;
        }
        @page {
          size: auto;
          margin: 8mm;
        }
        @media print {
          html, body {
            background: #ffffff;
            padding: 0;
          }
          .sheet {
            width: 100%;
            border: none;
            border-radius: 0;
            padding: 0;
          }
        }
        @media (max-width: 560px) {
          .details {
            grid-template-columns: 1fr;
          }
          .ticket-number-value {
            font-size: 30px;
          }
        }
      </style>
    </head>
    <body>
      <main class="sheet">
        <header class="header">
          <h1 class="title">${escapeHtml(title)}</h1>
          <p class="subtitle">WARDS Public Queueing Module</p>
        </header>
        <section class="ticket-number">
          <div class="ticket-number-label">Queue Number</div>
          <div class="ticket-number-value">${escapeHtml(queueNumber)}</div>
        </section>
        <section class="details">
          <article class="detail"><div class="detail-label">Branch</div><div class="detail-value">${formatDisplayValue(branchName)}</div></article>
          <article class="detail"><div class="detail-label">Queue Type</div><div class="detail-value">${formatDisplayValue(queueType)}</div></article>
          <article class="detail"><div class="detail-label">Service</div><div class="detail-value">${formatDisplayValue(serviceType, 'Not specified')}</div></article>
          <article class="detail"><div class="detail-label">Estimated Wait Time</div><div class="detail-value">${escapeHtml(formatWaitTime(estimatedWaitTime))}</div></article>
          <article class="detail"><div class="detail-label">Appointment Time</div><div class="detail-value">${formatDisplayValue(appointmentTime, 'Not applicable')}</div></article>
          <article class="detail"><div class="detail-label">Recommended Arrival Time</div><div class="detail-value">${formatDisplayValue(recommendedArrival)}</div></article>
          <article class="detail"><div class="detail-label">Date Registered</div><div class="detail-value">${formatDisplayValue(createdAt)}</div></article>
          <article class="detail"><div class="detail-label">Contact Number</div><div class="detail-value">${formatDisplayValue(contactNumber, 'Not provided')}</div></article>
          <article class="detail"><div class="detail-label">Taxpayer Name</div><div class="detail-value">${formatDisplayValue(taxpayerName, 'Not provided')}</div></article>
        </section>
        ${message ? `<section class="note">${escapeHtml(message)}</section>` : ''}
      </main>
      <script>
        window.onload = function () {
          window.print();
          window.onafterprint = function () { window.close(); };
        };
      </script>
    </body>
  </html>
`;

const formatDateTimeForPrint = (value, fallback = 'N/A') => {
  if (!value) {
    return fallback;
  }
  const formatted = formatUtc8DateTime(value, 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return formatted || fallback;
};

const formatContactNumber = (value) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  return normalized.startsWith('+63') ? normalized : normalized;
};

export const printQueueTicket = ({
  title = 'Queue Ticket',
  queueNumber,
  branchName,
  queueType,
  serviceType,
  appointmentTime,
  recommendedArrival,
  estimatedWaitTime,
  createdAt,
  taxpayerName,
  contactNumber,
  message,
}) => {
  const printWindow = window.open('', '_blank', 'width=820,height=900');
  if (!printWindow) {
    return false;
  }

  const queueTypeLabel = String(queueType ?? '').trim()
    ? `${String(queueType).charAt(0).toUpperCase()}${String(queueType).slice(1)}`
    : 'N/A';

  printWindow.document.write(
    buildTicketMarkup({
      title,
      queueNumber,
      branchName,
      queueType: queueTypeLabel,
      serviceType,
      appointmentTime: formatDateTimeForPrint(appointmentTime, 'Not applicable'),
      recommendedArrival: formatDateTimeForPrint(recommendedArrival),
      estimatedWaitTime,
      createdAt: formatDateTimeForPrint(createdAt || new Date().toISOString()),
      taxpayerName,
      contactNumber: formatContactNumber(contactNumber),
      message,
    }),
  );
  printWindow.document.close();
  return true;
};
