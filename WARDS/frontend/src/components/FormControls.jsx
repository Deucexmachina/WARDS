import { useEffect, useRef, useState } from 'react';

const CHEVRON = (
  <svg className="w-4 h-4 text-slate-400 flex-shrink-0 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
  </svg>
);

export const CustomSelect = ({
  value,
  onChange,
  disabled = false,
  options = [],
  placeholder = 'Select…',
  className = '',
  hasError = false,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, []);

  const selectedLabel = options.find((o) => String(o.value) === String(value))?.label ?? '';

  const base = `w-full flex items-center justify-between px-4 py-3 rounded-2xl border text-sm text-left transition outline-none`;
  const idle = hasError
    ? 'border-red-500 bg-red-50 text-red-900'
    : 'border-slate-300 bg-white text-slate-900 hover:border-blue-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';
  const dis = 'cursor-not-allowed bg-slate-100 border-slate-200 text-slate-400';
  const activeRing = open && !disabled && !hasError ? 'border-blue-500 ring-2 ring-blue-500/20' : '';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${base} ${disabled ? dis : idle} ${activeRing}`}
      >
        <span className={selectedLabel ? '' : 'text-slate-400'}>{selectedLabel || placeholder}</span>
        <span className={`transition-transform ${open ? 'rotate-180' : ''}`}>{CHEVRON}</span>
      </button>

      {open && !disabled && (
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          <div className="max-h-56 overflow-y-auto">
            {placeholder && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-50 transition ${value === '' ? 'bg-slate-50 font-semibold' : ''}`}
              >
                {placeholder}
              </button>
            )}
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 hover:text-blue-700 transition
                  ${String(opt.value) === String(value) ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const parseDate = (str) => {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
};

const toDateStr = (year, month, day) =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const formatDisplay = (str) => {
  if (!str) return '';
  const p = parseDate(str);
  if (!p) return str;
  return `${MONTHS[p.month]} ${p.day}, ${p.year}`;
};

export const CustomDatePicker = ({
  value,
  onChange,
  disabled = false,
  min,
  max,
  placeholder = 'Select date',
  className = '',
  hasError = false,
  name,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const today = new Date();
  const parsed = parseDate(value);
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth());

  useEffect(() => {
    if (parsed) { setViewYear(parsed.year); setViewMonth(parsed.month); }
  }, [value]);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, []);

  const minParsed = parseDate(min);
  const maxParsed = parseDate(max);

  const isDisabledDay = (year, month, day) => {
    const str = toDateStr(year, month, day);
    if (minParsed && str < toDateStr(minParsed.year, minParsed.month, minParsed.day)) return true;
    if (maxParsed && str > toDateStr(maxParsed.year, maxParsed.month, maxParsed.day)) return true;
    return false;
  };

  const selectDay = (year, month, day) => {
    const str = toDateStr(year, month, day);
    onChange({ target: { name, value: str } });
    setOpen(false);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedStr = value || '';

  const btnBase = 'w-full flex items-center justify-between px-4 py-3 rounded-2xl border text-sm text-left transition outline-none';
  const btnIdle = hasError
    ? 'border-red-500 bg-red-50 text-red-900'
    : 'border-slate-300 bg-white text-slate-900 hover:border-blue-400';
  const btnOpen = open && !disabled && !hasError ? 'border-blue-500 ring-2 ring-blue-500/20' : '';
  const btnDis = 'cursor-not-allowed bg-slate-100 border-slate-200 text-slate-400';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${btnBase} ${disabled ? btnDis : btnIdle} ${btnOpen}`}
      >
        <span className={value ? 'text-slate-900' : 'text-slate-400'}>{formatDisplay(value) || placeholder}</span>
        <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {open && !disabled && (
        <div className="absolute left-0 z-50 mt-1 w-72 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <button type="button" onClick={prevMonth} className="p-1 rounded-lg hover:bg-slate-100 transition text-slate-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-bold text-slate-800">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="p-1 rounded-lg hover:bg-slate-100 transition text-slate-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Day labels */}
          <div className="grid grid-cols-7 px-3 pt-2">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-xs font-semibold text-slate-400 py-1">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 px-3 pb-3 gap-y-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} />;
              const str = toDateStr(viewYear, viewMonth, day);
              const isSelected = str === selectedStr;
              const isToday = str === todayStr;
              const isDis = isDisabledDay(viewYear, viewMonth, day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={isDis}
                  onClick={() => selectDay(viewYear, viewMonth, day)}
                  className={`w-8 h-8 mx-auto flex items-center justify-center rounded-full text-sm transition
                    ${isSelected ? 'bg-blue-600 text-white font-bold' : ''}
                    ${!isSelected && isToday ? 'border border-blue-400 text-blue-600 font-semibold' : ''}
                    ${!isSelected && !isToday && !isDis ? 'text-slate-700 hover:bg-blue-50 hover:text-blue-600' : ''}
                    ${isDis ? 'text-slate-300 cursor-not-allowed' : 'cursor-pointer'}
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => { onChange({ target: { name, value: '' } }); setOpen(false); }}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                const t = today;
                const str = toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
                if (!isDisabledDay(t.getFullYear(), t.getMonth(), t.getDate())) {
                  selectDay(t.getFullYear(), t.getMonth(), t.getDate());
                } else {
                  setViewYear(t.getFullYear());
                  setViewMonth(t.getMonth());
                }
              }}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
