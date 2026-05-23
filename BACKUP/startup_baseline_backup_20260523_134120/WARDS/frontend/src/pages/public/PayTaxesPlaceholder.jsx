import { useNavigate, useParams } from 'react-router-dom';

const LABELS = {
  bt: {
    title: 'Business Tax',
    code: 'BT',
    message: 'The Business Tax online payment workflow is not wired in yet. This route is intentionally reserved so the user can choose it from the tax service selector.',
  },
  misc: {
    title: 'Miscellaneous Tax',
    code: 'MISC',
    message: 'The Miscellaneous Tax online payment workflow is not wired in yet. This route is intentionally reserved so the user can choose it from the tax service selector.',
  },
};

const PayTaxesPlaceholder = () => {
  const navigate = useNavigate();
  const { taxType } = useParams();

  if (taxType === 'bt') {
    return (
      <section className="min-h-screen bg-[radial-gradient(circle_at_top,#e7f0ff_0%,#f7f9fc_38%,#eef4fb_100%)] py-14">
        <div className="mx-auto max-w-[1840px] px-4 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-[34px] border border-blue-100 bg-white shadow-[0_24px_55px_rgba(15,52,108,0.12)]">
            <div className="relative h-40 w-full overflow-hidden bg-[linear-gradient(135deg,#0f2f5f_0%,#18437f_38%,#2d69b3_100%)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(255,255,255,0.18),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.12),transparent_24%),linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.08)_50%,transparent_100%)]"></div>
              <div className="absolute -left-12 top-8 h-40 w-40 rounded-full border border-white/10 bg-white/5"></div>
              <div className="absolute right-10 top-4 h-24 w-24 rotate-12 rounded-3xl border border-white/10 bg-white/5"></div>
              <div className="relative flex h-full items-center justify-center">
                <div className="rounded-full border border-white/20 bg-white/90 px-5 py-2 text-sm font-bold uppercase tracking-[0.28em] text-[#123f8f] shadow-sm sm:text-base">
                  WARDS Online Services
                </div>
              </div>
            </div>

            <div className="px-8 py-8 text-center sm:px-12">
              <h1 className="text-3xl font-semibold uppercase tracking-wide text-[#123f8f] sm:text-5xl">
                Welcome to <span className="text-[#0f2f5f]">Business Tax Assessment</span>
              </h1>
              <p className="mx-auto mt-5 max-w-5xl text-base leading-8 text-slate-600 sm:text-xl">
                This WARDS public module helps business owners start their Business Tax transaction online and connect with the City Treasurer&apos;s Office through the proper service channel.
              </p>
            </div>

            <div className="grid gap-6 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-2">
              <article className="rounded-[28px] border border-blue-100 bg-[linear-gradient(180deg,#eef5ff_0%,#dbe9fb_100%)] px-6 py-8 text-center shadow-[0_14px_35px_rgba(26,83,151,0.08)]">
                <h2 className="text-2xl font-semibold uppercase tracking-wide text-[#123f8f] sm:text-4xl">
                  2026 Business Tax
                </h2>
                <div className="mt-4 border-t border-white/90"></div>
                <h3 className="mt-6 text-2xl font-medium text-slate-900 sm:text-4xl">
                  Proceed and Pay Online
                </h3>
                <p className="mx-auto mt-8 max-w-4xl text-base leading-8 text-slate-700 sm:text-2xl">
                  You can now submit your Online Sales Declaration along with your Financial Statements and other requirements online. Assessment and settlement of payment can also be done through this portal.
                </p>
                <div className="mt-10">
                  <button
                    type="button"
                    onClick={() => navigate('/pay-taxes/bt/online')}
                    className="rounded-full bg-[linear-gradient(90deg,#3c67be_0%,#567ecf_100%)] px-8 py-4 text-base font-bold uppercase tracking-wide text-white shadow-[0_12px_24px_rgba(60,103,190,0.22)] transition hover:brightness-110 sm:px-14 sm:py-5 sm:text-2xl"
                  >
                    Proceed with Business Tax Assessment
                  </button>
                </div>
              </article>

              <article className="rounded-[28px] border border-[#d9e8fb] bg-[linear-gradient(180deg,#f4f8ff_0%,#e4eefc_100%)] px-6 py-8 text-center shadow-[0_14px_35px_rgba(15,47,95,0.08)]">
                <h2 className="text-2xl font-semibold uppercase tracking-wide text-[#123f8f] sm:text-4xl">
                  Appointment
                </h2>
                <div className="mt-4 border-t border-white/90"></div>
                <p className="mx-auto mt-14 max-w-4xl text-base leading-8 text-slate-700 sm:text-2xl">
                  Do you have any concerns regarding your Business Tax Assessment? You may visit the City Treasurer&apos;s Office by scheduling an appointment below:
                </p>
                <div className="mt-10">
                  <button
                    type="button"
                    onClick={() => navigate('/get-queue?service=Business%20Tax&queueType=appointment')}
                    className="rounded-full bg-[linear-gradient(90deg,#0f56d8_0%,#0b45b8_100%)] px-8 py-4 text-base font-bold uppercase tracking-wide text-white shadow-[0_14px_28px_rgba(11,69,184,0.24)] transition hover:brightness-110 sm:px-14 sm:py-5 sm:text-2xl"
                  >
                    Set an Appointment
                  </button>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const config = LABELS[taxType] || {
    title: 'Tax Module',
    code: 'TAX',
    message: 'This tax module is reserved for a future implementation pass.',
  };

  return (
    <section className="min-h-screen bg-[#f7f9fc] py-14">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-[34px] border border-slate-200 bg-white p-10 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-900 text-xl font-bold text-white">
            {config.code}
          </div>
          <h1 className="mt-8 text-4xl font-bold text-slate-900">{config.title}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">{config.message}</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate('/pay-taxes')}
              className="rounded-full bg-[#0f5b83] px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-[#0c4d6f]"
            >
              Back to Tax Service Selection
            </button>
            <button
              type="button"
              onClick={() => navigate('/pay-taxes/rpt')}
              className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold uppercase tracking-[0.12em] text-slate-700 transition hover:border-[#0f5b83] hover:text-[#0f5b83]"
            >
              Open RPT Module
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PayTaxesPlaceholder;
