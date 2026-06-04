import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-primary py-8 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 text-center sm:px-6 lg:px-8">
        <div>
          <p className="mb-2 font-semibold">&copy; 2026 City Treasurer&apos;s Office</p>
          <p className="text-sm text-blue-200">Official Online Tax Payment Portal</p>
        </div>
        <div className="flex justify-center gap-6 text-sm text-blue-100">
          <Link to="/data-privacy-agreement" className="font-semibold transition hover:text-white">
            Data Privacy Agreement
          </Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
