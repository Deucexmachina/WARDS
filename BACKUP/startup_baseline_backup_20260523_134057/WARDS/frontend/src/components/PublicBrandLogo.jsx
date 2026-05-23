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
    <div className={`flex items-center gap-3 rounded-2xl px-2 py-1 ${className}`}>
      <div className="flex items-center gap-2">
        {logos.map((logo) => (
          <div
            key={logo.alt}
            className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-transparent ring-1 ring-white/10 ${
              compact ? 'h-9 w-9 sm:h-10 sm:w-10' : 'h-10 w-10 sm:h-11 sm:w-11'
            }`}
          >
            <img src={logo.src} alt={logo.alt} className={`h-full w-full ${logo.imageClassName}`} />
          </div>
        ))}
      </div>
      <div className="hidden min-w-0 sm:block">
        <h1 className={`truncate font-bold text-white ${compact ? 'text-sm' : 'text-lg'}`}>{title}</h1>
        <p className="truncate text-xs text-blue-200">{subtitle}</p>
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
