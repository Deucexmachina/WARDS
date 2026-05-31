export const UNREAD_COUNT_BADGE_CLASS = 'inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-rose-600 px-2 py-1 text-xs font-bold text-white shadow-sm';

export const UNREAD_STATUS_BADGE_CLASS = 'inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200';

export const UNREAD_CARD_HIGHLIGHT_CLASS = 'border-rose-200 bg-rose-50/40 ring-1 ring-inset ring-rose-100';

export const formatUnreadCount = (count) => (Number(count || 0) > 99 ? '99+' : Number(count || 0));
