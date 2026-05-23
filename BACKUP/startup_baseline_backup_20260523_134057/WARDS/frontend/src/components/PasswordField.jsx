import { useState } from 'react';

const EyeIcon = ({ open }) => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {open ? (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </>
    ) : (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.956 9.956 0 012.2-3.592M6.223 6.223A9.965 9.965 0 0112 5c4.478 0 8.268 2.943 9.542 7a9.97 9.97 0 01-4.132 5.411M15 12a3 3 0 00-4.755-2.455M9.88 9.88A3 3 0 0014.12 14.12M3 3l18 18" />
      </>
    )}
  </svg>
);

const joinClasses = (...classes) => classes.filter(Boolean).join(' ');

const PasswordField = ({
  value = '',
  onChange,
  className = '',
  containerClassName = 'relative',
  buttonClassName = 'absolute inset-y-0 right-0 flex items-center px-4 text-gray-400 transition hover:text-gray-600',
  showToggleWhenEmpty = false,
  ...props
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const showToggle = showToggleWhenEmpty || Boolean(value);

  return (
    <div className={containerClassName}>
      <input
        {...props}
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className={joinClasses(className, showToggle ? 'pr-12' : '')}
      />
      {showToggle ? (
        <button
          type="button"
          onClick={() => setShowPassword((current) => !current)}
          className={buttonClassName}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          <EyeIcon open={showPassword} />
        </button>
      ) : null}
    </div>
  );
};

export default PasswordField;
