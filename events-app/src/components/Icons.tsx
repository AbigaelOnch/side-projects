const base = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const PinIcon = ({ c = "#F5C451" }: { c?: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" stroke={c} strokeWidth="2.2" {...base}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
);
export const PlusIcon = ({ c = "#1C1020" }: { c?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" stroke={c} strokeWidth="2.6" {...base}><path d="M12 5v14M5 12h14" /></svg>
);
export const ClockIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" stroke="#F5C451" strokeWidth="2" {...base}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const TicketIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" stroke="#F5C451" strokeWidth="2" {...base}><path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" /><path d="M14 7v10" /></svg>
);
export const PersonIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" stroke="#F5C451" strokeWidth="2" {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
export const BackIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" {...base}><path d="M15 6l-6 6 6 6" /></svg>
);
export const CalIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" {...base}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
);
