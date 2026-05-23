const StatCard = ({ title, value, icon, gradient }) => {
  return (
    <div className={`bg-gradient-to-br ${gradient} rounded-xl shadow-lg p-6 text-white`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white text-opacity-80 text-sm mb-1">{title}</p>
          <p className="text-3xl font-bold">{value}</p>
        </div>
        <svg className="w-12 h-12 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={icon}></path>
        </svg>
      </div>
    </div>
  );
};

export default StatCard;
