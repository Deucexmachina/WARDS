import { useNavigate } from 'react-router-dom';

const TAX_SERVICES = [
  {
    key: 'rpt',
    title: 'Real Property Tax',
    subtitle: 'RPT',
    description: 'Search by Tax Declaration Number, compute dues, build your cart, and proceed through treasury-assisted PayMongo payment validation.',
    status: 'Available',
    path: '/pay-taxes/rpt',
  },
  {
    key: 'bt',
    title: 'Business Tax',
    subtitle: 'BT',
    description: 'Choose between the Business Tax assessment route and the appointment-based queueing module for in-person assistance.',
    status: 'Available',
    path: '/pay-taxes/bt',
  },
];

const PayTaxes = () => {
  const navigate = useNavigate();

  return (
    <section className="min-h-screen bg-[#f7f9fc] py-14">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[34px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="border-b border-slate-200 bg-gradient-to-r from-[#0f2f5f] via-[#174580] to-[#235ea6] px-8 py-12 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blue-100">City Treasurer&apos;s Office</p>
            <h1 className="mt-4 text-4xl font-bold sm:text-5xl">Choose Your Tax Service</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-blue-100 sm:text-lg">
              Select the online tax payment module you want to use. Real Property Tax and Business Tax are both available through WARDS public-facing payment workflows.
            </p>
          </div>

          <div className="px-8 py-10 sm:px-10">
            <div className="grid gap-6 lg:grid-cols-2">
              {TAX_SERVICES.map((service) => {
                const isAvailable = service.status === 'Available';
                return (
                  <button
                    key={service.key}
                    type="button"
                    onClick={() => navigate(service.path)}
                    className={`group rounded-[30px] border p-7 text-left transition ${
                      isAvailable
                        ? 'border-[#0f5b83] bg-[#f7fbfe] shadow-[0_16px_36px_rgba(15,91,131,0.12)] hover:-translate-y-1 hover:bg-white'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className={`flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-bold ${
                        isAvailable ? 'bg-[#0f5b83] text-white' : 'bg-slate-300 text-slate-700'
                      }`}>
                        {service.subtitle}
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${
                      isAvailable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                        {service.status}
                      </span>
                    </div>
                    {service.title ? <h2 className="mt-6 text-2xl font-bold text-slate-900">{service.title}</h2> : null}
                    <p className={`${service.title ? 'mt-3' : 'mt-6'} text-sm leading-7 text-slate-600`}>{service.description}</p>
                    <div className={`mt-8 inline-flex items-center text-sm font-bold uppercase tracking-[0.16em] ${
                      isAvailable ? 'text-[#0f5b83]' : 'text-slate-500'
                    }`}>
                      {isAvailable ? 'Open Service' : 'View Module'}
                      <svg className="ml-2 h-4 w-4 transition group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PayTaxes;
