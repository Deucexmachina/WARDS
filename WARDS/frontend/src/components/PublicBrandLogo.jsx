import { Link } from 'react-router-dom';
import wardsLogo from '../assets/branding/wards_logo.png';
import qcLogo from '../assets/branding/qclogo_main.png';
import galasLogo from '../assets/branding/galas_logo.png';

const logos = [
  { src: wardsLogo, alt: 'WARDS official logo', imageClassName: 'object-contain p-1' },
  { src: qcLogo, alt: 'Quezon City official logo', imageClassName: 'object-contain p-1.5' },
  { src: galasLogo, alt: 'Galas Branch official logo', imageClassName: 'object-contain p-1' },
];

const PublicBrandLogo = ({
  clickable = true,
  title = "City Treasurer's Office",
  subtitle = 'WARDS Public Facing Module',
  className = '',
  compact = false,
}) => {
  const content = (
    <div className={`flex items-center gap-3 px-1 py-1 ${className}`}>
      {/* Logo cluster with a subtle separator after */}
      <div className="flex items-center gap-1.5">
        {logos.map((logo) => (
          <div
            key={logo.alt}
            className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5 ring-1 ring-white/20 ${
              compact ? 'h-8 w-8 sm:h-9 sm:w-9' : 'h-9 w-9 sm:h-10 sm:w-10'
            }`}
          >
            <img src={logo.src} alt={logo.alt} className={`h-full w-full ${logo.imageClassName}`} />
          </div>
        ))}
      </div>

      {/* Thin divider */}
      <span className="hidden sm:block h-8 w-px bg-white/15"></span>

      <div className="hidden min-w-0 sm:block">
        <h1 className={`truncate font-bold text-white leading-tight ${compact ? 'text-sm' : 'text-base'}`}>{title}</h1>
        <p className="truncate text-[11px] text-blue-300/70 tracking-wide">{subtitle}</p>
      </div>
    </div>
  );

  if (!clickable) {
    return content;
  }

  return (
    <Link to="/" aria-label="Go to WARDS public home page">
      {content}
    </Link>
  );
};

export default PublicBrandLogo;
